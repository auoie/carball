package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/packs"
)

// Shared training packs (00006_training_packs.sql): uploads under the day's and the account's limits, a pack by its code
// (its downloads counted once a day per viewer), browse and search, an owner's own and its delete, reports, and the
// admin's reads and hides. A banned owner's packs, and hidden ones, are out of every public read.

// SharedPack is a pack as listed: its code, name, description, creator (its owner's display name), type, difficulty,
// shots, downloads and when it was shared; Hidden (and why) on its owner's own list
type SharedPack struct {
	Code, Name, Description, Creator, Type, Difficulty string
	Shots                                              int
	Downloads                                          int64
	CreatedAt                                          time.Time
	Hidden                                             bool
	HiddenReason                                       string
}

// NewPack is a pack to share: its checked fields, and its file once its code is known (the file's id holds it)
type NewPack struct {
	Name, Description, Type, Difficulty string
	Shots                               int
	File                                func(code string) ([]byte, error)
}

// PackLimitError refuses an upload over a limit: the account's packs at their most (Total), else the day's uploads,
// Until when the oldest of them is a day old
type PackLimitError struct {
	Total bool
	Until time.Time
}

func (e PackLimitError) Error() string {
	if e.Total {
		return "the account has the most packs it may"
	}
	return "the account's uploads for the day are used"
}

// PackDay is the day's window for the uploads' limit
const PackDay = 24 * time.Hour

// (a public read's candidates: visible packs of owners with no ban in force at $1)
const packVisible = `p.hidden_at IS NULL
	AND NOT EXISTS (SELECT 1 FROM identities i JOIN bans b ON b.provider = i.provider AND b.subject = i.subject
		WHERE i.account_id = p.owner_id AND (b.until IS NULL OR b.until > $1))`

const packColumns = `p.code, p.name, p.description, a.name, p.type, p.difficulty, p.shots, p.downloads, p.created_at`

func scanPack(row pgx.CollectableRow) (SharedPack, error) {
	var p SharedPack
	err := row.Scan(&p.Code, &p.Name, &p.Description, &p.Creator, &p.Type, &p.Difficulty, &p.Shots, &p.Downloads, &p.CreatedAt)
	return p, err
}

// CreatePack shares a pack as the account's: at most perDay uploads in a day (every upload counted, a pack deleted since
// too) and total packs at a time (PackLimitError); its code fresh. One upload of an account at a time (its row locked)
func (s *Store) CreatePack(ctx context.Context, owner string, p NewPack, now time.Time, perDay, total int) (string, error) {
	var code string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var one int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, owner).Scan(&one); errors.Is(err, pgx.ErrNoRows) {
			return ErrNoAccount
		} else if err != nil {
			return err
		}
		var today int
		var oldest *time.Time
		if err := tx.QueryRow(ctx, `SELECT count(*), min(uploaded_at) FROM pack_uploads WHERE account_id = $1 AND uploaded_at > $2`,
			owner, now.Add(-PackDay)).Scan(&today, &oldest); err != nil {
			return err
		}
		if today >= perDay && oldest != nil {
			return PackLimitError{Until: oldest.Add(PackDay)}
		}
		var held int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM training_packs WHERE owner_id = $1`, owner).Scan(&held); err != nil {
			return err
		}
		if held >= total {
			return PackLimitError{Total: true}
		}
		// (a code taken already, 1 in 2^64 a try: another)
		for range 5 {
			c := packs.NewCode()
			file, err := p.File(c)
			if err != nil {
				return err
			}
			tag, err := tx.Exec(ctx, `INSERT INTO training_packs (code, owner_id, name, description, type, difficulty, shots, pack, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (code) DO NOTHING`,
				c, owner, p.Name, p.Description, p.Type, p.Difficulty, p.Shots, file, now)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 1 {
				code = c
				break
			}
		}
		if code == "" {
			return errors.New("no free share code")
		}
		_, err := tx.Exec(ctx, `INSERT INTO pack_uploads (account_id, uploaded_at) VALUES ($1, $2)`, owner, now)
		return err
	})
	return code, err
}

// PackByCode is a visible pack (its listing, and its file with its creator filled in), its downloads counted for
// `viewer` (an account's id, or an address's keyed hash) once on now's UTC day; ok false for none
func (s *Store) PackByCode(ctx context.Context, code string, viewer []byte, now time.Time) (SharedPack, []byte, bool, error) {
	var p SharedPack
	var file []byte
	found := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT `+packColumns+`, jsonb_set(p.pack, '{creator}', to_jsonb(a.name))
			FROM training_packs p JOIN accounts a ON a.id = p.owner_id WHERE p.code = $2 AND `+packVisible, now, code)
		err := row.Scan(&p.Code, &p.Name, &p.Description, &p.Creator, &p.Type, &p.Difficulty, &p.Shots, &p.Downloads, &p.CreatedAt, &file)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		tag, err := tx.Exec(ctx, `INSERT INTO pack_downloads (code, viewer, day) VALUES ($1, $2, ($3::timestamptz AT TIME ZONE 'UTC')::date)
			ON CONFLICT DO NOTHING`, code, viewer, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			return tx.QueryRow(ctx, `UPDATE training_packs SET downloads = downloads + 1 WHERE code = $1 RETURNING downloads`, code).Scan(&p.Downloads)
		}
		return nil
	})
	return p, file, found, err
}

// PackCursor is where a browse's page ends: its last pack's code, time and downloads (the next page's after it)
type PackCursor struct {
	CreatedAt time.Time
	Code      string
	Downloads int64
}

// BrowsePacks is a page of the visible packs: newest first, or the most downloaded (then the newest); `search` a part of
// their names (any case; "" all), after `after` (nil: the first page), n of them
func (s *Store) BrowsePacks(ctx context.Context, search string, byDownloads bool, after *PackCursor, n int, now time.Time) ([]SharedPack, error) {
	q := `SELECT ` + packColumns + ` FROM training_packs p JOIN accounts a ON a.id = p.owner_id WHERE ` + packVisible
	args := []any{now}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if search != "" {
		q += ` AND p.name ILIKE ` + arg("%"+likeEscaper.Replace(search)+"%") + ` ESCAPE '\'`
	}
	if byDownloads {
		if after != nil {
			q += fmt.Sprintf(` AND (p.downloads, p.created_at, p.code) < (%s, %s, %s)`, arg(after.Downloads), arg(after.CreatedAt), arg(after.Code))
		}
		q += ` ORDER BY p.downloads DESC, p.created_at DESC, p.code DESC`
	} else {
		if after != nil {
			q += fmt.Sprintf(` AND (p.created_at, p.code) < (%s, %s)`, arg(after.CreatedAt), arg(after.Code))
		}
		q += ` ORDER BY p.created_at DESC, p.code DESC`
	}
	q += ` LIMIT ` + arg(n)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPack)
}

// likeEscaper: a search's text as an ILIKE pattern's, its wildcards and the escape itself taken literally
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// OwnPacks are an account's own packs, newest first, hidden ones too (with why)
func (s *Store) OwnPacks(ctx context.Context, owner string) ([]SharedPack, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+packColumns+`, p.hidden_at IS NOT NULL, coalesce(p.hidden_reason, '')
		FROM training_packs p JOIN accounts a ON a.id = p.owner_id WHERE p.owner_id = $1 ORDER BY p.created_at DESC, p.code DESC`, owner)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SharedPack, error) {
		var p SharedPack
		err := row.Scan(&p.Code, &p.Name, &p.Description, &p.Creator, &p.Type, &p.Difficulty, &p.Shots, &p.Downloads, &p.CreatedAt, &p.Hidden, &p.HiddenReason)
		return p, err
	})
}

// DeletePack deletes an owner's pack (its downloads' and reports' records with it); false: no such pack of theirs
func (s *Store) DeletePack(ctx context.Context, code, owner string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM training_packs WHERE code = $1 AND owner_id = $2`, code, owner)
	return tag.RowsAffected() == 1, err
}

// ReportPack records an account's report of a visible pack (once: again is the same report); false: no such pack
func (s *Store) ReportPack(ctx context.Context, code, account string, now time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO pack_reports (code, account_id, reported_at)
		SELECT p.code, $3, $1 FROM training_packs p WHERE p.code = $2 AND `+packVisible+`
		ON CONFLICT (code, account_id) DO UPDATE SET reported_at = pack_reports.reported_at`, now, code, account)
	return tag.RowsAffected() == 1, err
}

// --- The admin's ---

// AdminPack is a pack as the admin's commands list it: its listing, owner, reports, and a hide's when, why and who
type AdminPack struct {
	SharedPack
	Owner                string
	Reports              int
	LastReport, HiddenAt *time.Time
	HiddenBy             string
}

const adminPackColumns = packColumns + `, p.owner_id::text,
	(SELECT count(*) FROM pack_reports r WHERE r.code = p.code), (SELECT max(r.reported_at) FROM pack_reports r WHERE r.code = p.code),
	p.hidden_at, coalesce(p.hidden_reason, ''), coalesce(p.hidden_by, '')`

func scanAdminPack(row pgx.CollectableRow) (AdminPack, error) {
	var p AdminPack
	err := row.Scan(&p.Code, &p.Name, &p.Description, &p.Creator, &p.Type, &p.Difficulty, &p.Shots, &p.Downloads, &p.CreatedAt,
		&p.Owner, &p.Reports, &p.LastReport, &p.HiddenAt, &p.HiddenReason, &p.HiddenBy)
	p.Hidden = p.HiddenAt != nil
	return p, err
}

// RecentPacks are the n newest packs, hidden ones too
func (s *Store) RecentPacks(ctx context.Context, n int) ([]AdminPack, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+adminPackColumns+` FROM training_packs p JOIN accounts a ON a.id = p.owner_id
		ORDER BY p.created_at DESC, p.code DESC LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanAdminPack)
}

// ReportedPacks are the packs with reports, the most reported first (then the latest reported)
func (s *Store) ReportedPacks(ctx context.Context) ([]AdminPack, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+adminPackColumns+` FROM training_packs p JOIN accounts a ON a.id = p.owner_id
		WHERE EXISTS (SELECT 1 FROM pack_reports r WHERE r.code = p.code) ORDER BY 11 DESC, 12 DESC, p.code`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanAdminPack)
}

// PacksOf are an account's packs, newest first, hidden ones too
func (s *Store) PacksOf(ctx context.Context, owner string) ([]AdminPack, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+adminPackColumns+` FROM training_packs p JOIN accounts a ON a.id = p.owner_id
		WHERE p.owner_id = $1 ORDER BY p.created_at DESC, p.code DESC`, owner)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanAdminPack)
}

// ErrNoPack: no pack by that code
var ErrNoPack = errors.New("no such pack")

// HidePack hides a pack from every public read (its owner still lists it, hidden, with the reason); a hidden one's hide
// replaced
func (s *Store) HidePack(ctx context.Context, code, reason, by string, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE training_packs SET hidden_at = $2, hidden_reason = $3, hidden_by = $4 WHERE code = $1`, code, now, reason, by)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoPack
	}
	return err
}

// UnhidePack shows a hidden pack again; false: it wasn't hidden
func (s *Store) UnhidePack(ctx context.Context, code string) (bool, error) {
	var exists, was bool
	err := s.pool.QueryRow(ctx, `WITH old AS (SELECT hidden_at IS NOT NULL AS was FROM training_packs WHERE code = $1),
		upd AS (UPDATE training_packs SET hidden_at = NULL, hidden_reason = NULL, hidden_by = NULL WHERE code = $1)
		SELECT EXISTS (SELECT 1 FROM old), coalesce((SELECT was FROM old), false)`, code).Scan(&exists, &was)
	if err == nil && !exists {
		return false, ErrNoPack
	}
	return was, err
}
