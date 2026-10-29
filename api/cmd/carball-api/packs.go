package main

// The admin's commands on the shared training packs (notes/custom-training.md §9): the newest or the reported (reads),
// an account's, a pack hidden from every public read with why and by whom, or shown again. Each command's arguments
// checked before the database is opened (a typo runs nothing)

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"carball/api/internal/packs"
	"carball/api/internal/store"
)

// packRows: the packs as the admin's lists show them
func packRows(list []store.AdminPack) [][]string {
	rows := make([][]string, len(list))
	for i, p := range list {
		hidden := "-"
		if p.HiddenAt != nil {
			hidden = fmt.Sprintf("%s by %q: %q", p.HiddenAt.UTC().Format(stamp), p.HiddenBy, p.HiddenReason)
		}
		reports := strconv.Itoa(p.Reports)
		if p.LastReport != nil {
			reports += " (last " + p.LastReport.UTC().Format(stamp) + ")"
		}
		rows[i] = []string{p.Code, strconv.Quote(p.Name), p.Owner, strconv.Quote(p.Creator), strconv.Itoa(p.Shots),
			strconv.FormatInt(p.Downloads, 10), p.CreatedAt.UTC().Format(stamp), reports, hidden}
	}
	return rows
}

var packHeader = []string{"CODE", "NAME", "OWNER", "CREATOR", "SHOTS", "DOWNLOADS", "SHARED", "REPORTS", "HIDDEN"}

// packList: the newest packs (--recent [N]) or the reported ones (--reported)
func packList(args []string, out io.Writer) error {
	fs := flagsFor("packs")
	recent := fs.Bool("recent", false, "the newest packs, hidden ones too: N of them after it (20 by default, 1000 at most)")
	reported := fs.Bool("reported", false, "the packs with reports, the most reported first")
	rest, err := parseArgs(fs, args, out, 0, 1)
	if err != nil {
		return err
	}
	var read func(*store.Store) ([]store.AdminPack, error)
	switch {
	case *recent && !*reported:
		n, err := countOf(rest, 20, "packs --recent [N]")
		if err != nil {
			return err
		}
		read = func(db *store.Store) ([]store.AdminPack, error) { return db.RecentPacks(context.Background(), n) }
	case *reported && !*recent && len(rest) == 0:
		read = func(db *store.Store) ([]store.AdminPack, error) { return db.ReportedPacks(context.Background()) }
	default:
		return errors.New("packs --recent [N] or packs --reported (carball-api packs -h)")
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := read(db)
	if err != nil {
		return err
	}
	return table(out, packHeader, packRows(list))
}

// packsOf: an account's packs, newest first, hidden ones too
func packsOf(args []string, out io.Writer) error {
	rest, err := parseArgs(flagsFor("pack"), args, out, 1, 1)
	if err != nil {
		return err
	}
	if !accountID.MatchString(rest[0]) {
		return errors.New("pack ACCOUNT (an account's id, as accounts lists it)")
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := db.PacksOf(context.Background(), strings.ToLower(rest[0]))
	if err != nil {
		return err
	}
	return table(out, packHeader, packRows(list))
}

// packCode: a share code as typed (any case), checked
func packCode(arg string) (string, error) {
	code := strings.ToUpper(arg)
	if !packs.ValidCode(code) {
		return "", fmt.Errorf("%q: not a share code (XXXX-XXXX-XXXX-XXXX)", arg)
	}
	return code, nil
}

// packHide: a pack hidden from browse, search and its code's read, with why and by whom (its owner sees it hidden, and
// why); a hidden one's hide replaced
func packHide(args []string, out io.Writer) error {
	fs := flagsFor("pack-hide")
	reason := fs.String("reason", "", "why (its owner sees it on their list)")
	by := fs.String("by", "", "who hides it")
	rest, err := parseArgs(fs, args, out, 1, 1)
	if err != nil {
		return err
	}
	code, err := packCode(rest[0])
	if err != nil {
		return err
	}
	if strings.TrimSpace(*reason) == "" || strings.TrimSpace(*by) == "" {
		return errors.New("--reason and --by are required")
	}
	db, err := openStore(false)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.HidePack(context.Background(), code, *reason, *by, time.Now()); errors.Is(err, store.ErrNoPack) {
		return fmt.Errorf("no pack %s", code)
	} else if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(out, "pack %s hidden (by %q: %q)\n", code, *by, *reason)
	return nil
}

// packUnhide: a hidden pack shown again
func packUnhide(args []string, out io.Writer) error {
	rest, err := parseArgs(flagsFor("pack-unhide"), args, out, 1, 1)
	if err != nil {
		return err
	}
	code, err := packCode(rest[0])
	if err != nil {
		return err
	}
	db, err := openStore(false)
	if err != nil {
		return err
	}
	defer db.Close()
	was, err := db.UnhidePack(context.Background(), code)
	switch {
	case errors.Is(err, store.ErrNoPack):
		return fmt.Errorf("no pack %s", code)
	case err != nil:
		return err
	case !was:
		_, _ = fmt.Fprintf(out, "pack %s wasn't hidden\n", code)
	default:
		_, _ = fmt.Fprintf(out, "pack %s shown again\n", code)
	}
	return nil
}
