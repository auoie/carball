package main

// The admin's reports on the live app (stats, matches, account, ratings, queue-bans): read-only, from what the service
// keeps already, times in UTC; each command's arguments checked before the database is opened (a typo runs nothing)

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"carball/api/internal/ranked"
	"carball/api/internal/store"
)

// stamp is a time as the reports show it: UTC, to the minute
const stamp = "2006-01-02 15:04"

// countOf: a count argument (none: def), 1 to 1000; `what` names it in the error
func countOf(args []string, def int, what string) (int, error) {
	switch len(args) {
	case 0:
		return def, nil
	case 1:
		if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 && n <= 1000 {
			return n, nil
		}
	}
	return 0, fmt.Errorf("%s: N a count from 1 to 1000", what)
}

// playlistOf: 1v1, 2v2 or 3v3 as the playlist's team size
func playlistOf(name string) (int, error) {
	switch name {
	case "1v1":
		return 1, nil
	case "2v2":
		return 2, nil
	case "3v3":
		return 3, nil
	}
	return 0, fmt.Errorf("--playlist %q: 1v1, 2v2 or 3v3", name)
}

func playlistName(p int) string { return fmt.Sprintf("%dv%d", p, p) }

var accountID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// shownRating: a rating as the page shows it at now, "?" after it while provisional (its deviation grown by the time
// since its last game)
func shownRating(r store.Rating, now time.Time) string {
	r.Deviation = ranked.Idle(r, now)
	text := strconv.Itoa(int(ranked.Shown(r).Rating))
	if r.Deviation >= ranked.Provisional {
		text += "?"
	}
	return text
}

// playerName: a result's player as the reports name them (a deleted account's placeholder)
func playerName(p store.MatchPlayer) string {
	if p.Account == "" {
		return "(deleted)"
	}
	return strconv.Quote(p.Name)
}

// matchRow: a result's time, playlist, each team's players, the winner and who left
func matchRow(m store.MatchSummary) []string {
	var teams [2][]string
	var left []string
	for _, p := range m.Players {
		teams[p.Team&1] = append(teams[p.Team&1], playerName(p))
		if p.Quitter {
			left = append(left, playerName(p))
		}
	}
	quit := "-"
	if len(left) > 0 {
		quit = strings.Join(left, " ")
	}
	return []string{m.At.UTC().Format(stamp), playlistName(m.Playlist), strings.Join(teams[0], " "), strings.Join(teams[1], " "),
		teamName(m.Winner), quit}
}

func teamName(team int) string {
	if team == 0 {
		return "blue"
	}
	return "orange"
}

func table(out io.Writer, header []string, rows [][]string) error {
	w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, strings.Join(header, "\t"))
	for _, r := range rows {
		_, _ = fmt.Fprintln(w, strings.Join(r, "\t"))
	}
	return w.Flush()
}

func stats(args []string, out io.Writer) error {
	if _, err := parseArgs(flagsFor("stats"), args, out, 0, 0); err != nil {
		return err
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	now := time.Now()
	st, err := db.StatsAt(context.Background(), now)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(out, "Carball at %s UTC (today: since 00:00 UTC; week: the last 7 days)\n\n", now.UTC().Format(stamp))
	rows := [][]string{{"accounts", strconv.Itoa(st.NewToday), strconv.Itoa(st.NewWeek), strconv.Itoa(st.Accounts)}}
	for p := 1; p <= 3; p++ {
		rows = append(rows, []string{playlistName(p) + " matches", strconv.Itoa(st.MatchesToday[p]), strconv.Itoa(st.MatchesWeek[p]), ""})
	}
	if err := table(out, []string{"", "TODAY", "WEEK", "TOTAL"}, rows); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(out, "\nbans in force: %d accounts' identities; leave bans in force: %d\n", st.Bans, st.QueueBans)
	return nil
}

func matches(args []string, out io.Writer) error {
	fs := flagsFor("matches")
	recent := fs.Bool("recent", false, "the latest ranked results, N of them after it (20 by default, 1000 at most)")
	rest, err := parseArgs(fs, args, out, 0, 1)
	if err != nil {
		return err
	}
	if !*recent {
		return errors.New("matches --recent [N] (carball-api matches -h)")
	}
	n, err := countOf(rest, 20, "matches --recent [N]")
	if err != nil {
		return err
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := db.RecentMatches(context.Background(), n)
	if err != nil {
		return err
	}
	rows := make([][]string, 0, len(list))
	for _, m := range list {
		rows = append(rows, matchRow(m))
	}
	return table(out, []string{"TIME (UTC)", "PLAYLIST", "BLUE", "ORANGE", "WINNER", "LEFT"}, rows)
}

func account(args []string, out io.Writer) error {
	rest, err := parseArgs(flagsFor("account"), args, out, 1, 1)
	if err != nil {
		return err
	}
	if !accountID.MatchString(rest[0]) {
		return errors.New("account ID (an account's id, as accounts lists it)")
	}
	id := strings.ToLower(rest[0])
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx := context.Background()
	now := time.Now()
	found, ok, err := db.FoundAccount(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("no account %s", id)
	}
	ratings, err := db.RatingsOf(ctx, id)
	if err != nil {
		return err
	}
	var banLines []string
	var ids []string
	for _, i := range found.Identities {
		ids = append(ids, string(i.Provider)+":"+i.Subject)
		b, banned, err := db.BanOn(ctx, i.Provider, i.Subject, now)
		if err != nil {
			return err
		}
		if banned {
			banLines = append(banLines, fmt.Sprintf("%s %s, by %s: %q", shown(i.Provider, i.Subject), describe(b.End), b.By, b.Reason))
		}
	}
	leave, hasLeave, err := db.QueueBanOf(ctx, id)
	if err != nil {
		return err
	}
	list, err := db.MatchesOf(ctx, id, 10)
	if err != nil {
		return err
	}
	seen := "-"
	if found.LastSeen != nil {
		seen = found.LastSeen.UTC().Format(time.DateOnly) + " (its latest session: to a day)"
	}
	var shown []string
	for p := 1; p <= 3; p++ {
		r, played := ratings[p]
		if !played {
			r = ranked.Default
		}
		shown = append(shown, fmt.Sprintf("%s %s (%d games)", playlistName(p), shownRating(r, now), r.Games))
	}
	ban := "none"
	if len(banLines) > 0 {
		ban = strings.Join(banLines, "; ")
	}
	leaveBan := "none"
	if hasLeave {
		state := "ended"
		if leave.Until.After(now) {
			state = "in force"
		}
		leaveBan = fmt.Sprintf("step %d, until %s UTC (%s)", leave.Step, leave.Until.UTC().Format(stamp), state)
	}
	if err := table(out, []string{"ACCOUNT", found.ID}, [][]string{
		{"NAME", strconv.Quote(found.Name)},
		{"CREATED", found.CreatedAt.UTC().Format(time.DateOnly)},
		{"LAST SEEN", seen},
		{"IDENTITIES", strings.Join(ids, " ")},
		{"RATINGS", strings.Join(shown, ", ")},
		{"BAN", ban},
		{"LEAVE BAN", leaveBan},
	}); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(out)
	rows := make([][]string, 0, len(list))
	for _, m := range list {
		row := matchRow(m)
		for _, p := range m.Players {
			if p.Account == id {
				result := "lost"
				if p.Team == m.Winner {
					result = "won"
				}
				before := p.Before
				if before == 0 {
					before = ranked.Default.Rating // (a first game in the playlist: kept as 0, begun from the default)
				}
				row = append(row, fmt.Sprintf("%s, %.0f → %.0f", result, before, p.After))
			}
		}
		rows = append(rows, row)
	}
	return table(out, []string{"TIME (UTC)", "PLAYLIST", "BLUE", "ORANGE", "WINNER", "LEFT", "THIS ACCOUNT"}, rows)
}

func ratingsBoard(args []string, out io.Writer) error {
	fs := flagsFor("ratings")
	top := fs.Bool("top", false, "the leaderboard: the top N after it (20 by default, 1000 at most)")
	playlist := fs.String("playlist", "1v1", "1v1, 2v2 or 3v3")
	rest, err := parseArgs(fs, args, out, 0, 1)
	if err != nil {
		return err
	}
	if !*top {
		return errors.New("ratings --top [N] [--playlist 1v1|2v2|3v3] (carball-api ratings -h)")
	}
	n, err := countOf(rest, 20, "ratings --top [N]")
	if err != nil {
		return err
	}
	p, err := playlistOf(*playlist)
	if err != nil {
		return err
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	all, err := db.PlaylistRatings(context.Background(), p)
	if err != nil {
		return err
	}
	return table(out, []string{"RANK", "NAME", "RATING", "GAMES", "ACCOUNT"}, leaderboard(all, n, time.Now()))
}

// leaderboard: the top n by the rating as shown (provisional ones marked), ties by games then name
func leaderboard(all []store.Rated, n int, now time.Time) [][]string {
	slices.SortStableFunc(all, func(a, b store.Rated) int {
		ra, rb := ranked.Shown(a.Rating).Rating, ranked.Shown(b.Rating).Rating
		switch {
		case ra != rb:
			return int(rb) - int(ra)
		case a.Rating.Games != b.Rating.Games:
			return b.Rating.Games - a.Rating.Games
		}
		return strings.Compare(a.Name, b.Name)
	})
	rows := make([][]string, 0, min(n, len(all)))
	for i, r := range all {
		if i == n {
			break
		}
		rows = append(rows, []string{strconv.Itoa(i + 1), strconv.Quote(r.Name), shownRating(r.Rating, now), strconv.Itoa(r.Rating.Games), r.Account})
	}
	return rows
}

func queueBans(args []string, out io.Writer) error {
	if _, err := parseArgs(flagsFor("queue-bans"), args, out, 0, 0); err != nil {
		return err
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := db.QueueBans(context.Background(), time.Now())
	if err != nil {
		return err
	}
	rows := make([][]string, 0, len(list))
	for _, q := range list {
		rows = append(rows, []string{q.Account, strconv.Quote(q.Name), strconv.Itoa(q.Step), q.Until.UTC().Format(stamp), q.LastLeave.UTC().Format(stamp)})
	}
	return table(out, []string{"ACCOUNT", "NAME", "STEP", "UNTIL (UTC)", "LAST LEAVE (UTC)"}, rows)
}
