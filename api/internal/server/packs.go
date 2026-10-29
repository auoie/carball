package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"carball/api/internal/packs"
	"carball/api/internal/ratelimit"
	"carball/api/internal/store"
)

// Shared training packs (notes/custom-training.md §9; the user's, 2026-10-29): POST /api/packs shares the signed-in
// account's pack (strictly checked: internal/packs; its uploads limited a day, per account kept in the database and per
// address in memory, and its packs at a time), GET /api/packs/{code} hands one out (public; its downloads counted once a
// day per account or address), GET /api/packs browses and searches them (public, a page at a time, the first pages kept
// a while), GET /api/me/packs lists the account's own, DELETE /api/packs/{code} deletes one of them, POST
// /api/packs/{code}/report reports one. Packs are data, never evaluated; their texts are the page's to show as text.

const (
	// PacksPerDay is an account's uploads in a day (a pack deleted since counted too)
	PacksPerDay = 10
	// PacksPerAccount is the packs an account may have at a time
	PacksPerAccount = 100
	// BrowsePage is how many packs a browse's page lists
	BrowsePage = 30
	// BrowseKept is how long a browse's first page (no search) is answered from its last read
	BrowseKept = 30 * time.Second
	// SearchMax is a search's longest text (a pack name's)
	SearchMax = packs.NameMax
)

// packItem is a pack as listed (browse, the account's own, one handed out)
type packItem struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Creator      string `json:"creator"`
	Type         string `json:"type"`
	Difficulty   string `json:"difficulty"`
	Shots        int    `json:"shots"`
	Downloads    int64  `json:"downloads"`
	CreatedAt    string `json:"createdAt"`
	Hidden       bool   `json:"hidden,omitempty"`
	HiddenReason string `json:"hiddenReason,omitempty"`
}

func itemOf(p store.SharedPack) packItem {
	return packItem{Code: p.Code, Name: p.Name, Description: p.Description, Creator: p.Creator, Type: p.Type, Difficulty: p.Difficulty,
		Shots: p.Shots, Downloads: p.Downloads, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339), Hidden: p.Hidden, HiddenReason: p.HiddenReason}
}

// sharePack: the signed-in account's pack shared; its share code
func (s *Server) sharePack(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	now := s.Now()
	// (the address's day: taken before the pack is read, a refused one too, so tries can't probe the checks for free)
	if !s.allowAddress(r, now, s.packUploads, s.packUploadsWide) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		badBody(w, err)
		return
	}
	p, err := packs.Parse(raw)
	var refused *packs.Error
	if errors.As(err, &refused) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": refused.Code, "detail": refused.Detail})
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "pack-invalid")
		return
	}
	code, err := s.Store.CreatePack(r.Context(), ss.AccountID, store.NewPack{
		Name: p.Name, Description: p.Description, Type: p.Type, Difficulty: p.Difficulty, Shots: len(p.Shots),
		File: func(code string) ([]byte, error) { return p.File(packs.SharedID(code), "") },
	}, now, PacksPerDay, PacksPerAccount)
	var limit store.PackLimitError
	switch {
	case errors.As(err, &limit) && limit.Total:
		writeJSON(w, http.StatusConflict, map[string]any{"error": "pack-limit", "most": PacksPerAccount})
		return
	case errors.As(err, &limit):
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "pack-uploads", "seconds": secondsUntil(limit.Until, now)})
		return
	case err != nil:
		s.log(r).Error("sharing a pack", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	s.public.browse[0].forget()
	s.public.browse[1].forget()
	s.log(r).Info("pack shared", "code", code, "pack", p.Name, "shots", len(p.Shots))
	writeJSON(w, http.StatusCreated, map[string]string{"code": code})
}

// viewer is who a download is counted for: the signed-in account (any of its addresses), else the address's keyed hash
// (HMAC with the server's secret: the database keeps no address)
func (s *Server) viewer(r *http.Request) []byte {
	if tok := cookie(r, sessionCookie); tok != "" {
		if ss, ok, err := s.Store.SessionByToken(r.Context(), digest(tok), s.Now()); err == nil && ok {
			whoOf(r).signedIn(ss.AccountID, ss.AccountName)
			if id, err := accountBytes(ss.AccountID); err == nil {
				return id[:]
			}
		}
	}
	m := hmac.New(sha256.New, s.DeletionKey)
	_, _ = io.WriteString(m, "pack-viewer:"+ratelimit.ClientKey(r, s.TrustedProxies))
	return m.Sum(nil)
}

// pack: one pack by its code (public): its listing and its file (its creator its owner's display name now)
func (s *Server) pack(w http.ResponseWriter, r *http.Request) {
	now := s.Now()
	if !s.allowAddress(r, now, s.packReads, s.packReadsWide) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	code := r.PathValue("code")
	if !packs.ValidCode(code) {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	p, file, found, err := s.Store.PackByCode(r.Context(), code, s.viewer(r), now)
	if err != nil {
		s.log(r).Error("reading a pack", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		packItem
		Pack json.RawMessage `json:"pack"`
	}{itemOf(p), file})
}

// browseBody is a browse's page: its packs, and the cursor of the next (none: the last)
type browseBody struct {
	Packs []packItem `json:"packs"`
	Next  *string    `json:"next"`
}

// browse: a page of the visible packs (public): `search` a part of their names, `sort` new (the default) or downloads,
// `cursor` the page after another's; the first pages without a search kept BrowseKept
func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	now := s.Now()
	if !s.allowAddress(r, now, s.packReads, s.packReadsWide) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("search"))
	sort := q.Get("sort")
	if sort == "" {
		sort = "new"
	}
	byDownloads := sort == "downloads"
	if (sort != "new" && !byDownloads) || len(search) > SearchMax || !printableASCII(search) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	var after *store.PackCursor
	if c := q.Get("cursor"); c != "" {
		cursor, ok := parseCursor(c)
		if !ok {
			writeError(w, http.StatusBadRequest, "bad-request")
			return
		}
		after = &cursor
	}
	read := func(ctx context.Context) ([]byte, error) {
		rows, err := s.Store.BrowsePacks(ctx, search, byDownloads, after, BrowsePage+1, now)
		if err != nil {
			return nil, err
		}
		out := browseBody{Packs: []packItem{}}
		for i, p := range rows {
			if i == BrowsePage {
				next := cursorOf(rows[i-1])
				out.Next = &next
				break
			}
			out.Packs = append(out.Packs, itemOf(p))
		}
		return json.Marshal(out)
	}
	var body []byte
	var err error
	if search == "" && after == nil {
		kept := &s.public.browse[0]
		if byDownloads {
			kept = &s.public.browse[1]
		}
		body, err = kept.get(r.Context(), now, BrowseKept, s.Log, "the packs' first page", read)
	} else {
		body, err = read(r.Context())
	}
	if err != nil {
		if r.Context().Err() == nil {
			s.log(r).Error("browsing packs", "err", err)
			writeError(w, http.StatusServiceUnavailable, "unavailable")
		}
		return
	}
	writeBody(w, body)
}

// printableASCII: every byte a printable ASCII character (a space too)
func printableASCII(t string) bool {
	for i := 0; i < len(t); i++ {
		if t[i] < 0x20 || t[i] > 0x7e {
			return false
		}
	}
	return true
}

// cursorOf: a page's last pack as the next page's cursor (opaque to the page: its time, downloads and code)
func cursorOf(p store.SharedPack) string {
	return base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, "%d.%d.%s", p.CreatedAt.UnixMicro(), p.Downloads, p.Code))
}

func parseCursor(c string) (store.PackCursor, bool) {
	if len(c) > 80 {
		return store.PackCursor{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return store.PackCursor{}, false
	}
	parts := strings.Split(string(raw), ".")
	if len(parts) != 3 || !packs.ValidCode(parts[2]) {
		return store.PackCursor{}, false
	}
	micro, err1 := strconv.ParseInt(parts[0], 10, 64)
	downloads, err2 := strconv.ParseInt(parts[1], 10, 64)
	if err1 != nil || err2 != nil || micro < 0 || downloads < 0 {
		return store.PackCursor{}, false
	}
	return store.PackCursor{CreatedAt: time.UnixMicro(micro).UTC(), Downloads: downloads, Code: parts[2]}, true
}

// myPacks: the signed-in account's own packs, newest first (hidden ones too, with why)
func (s *Server) myPacks(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	own, err := s.Store.OwnPacks(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading an account's packs", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	out := struct {
		Packs []packItem `json:"packs"`
		Most  int        `json:"most"`
	}{Packs: []packItem{}, Most: PacksPerAccount}
	for _, p := range own {
		out.Packs = append(out.Packs, itemOf(p))
	}
	writeJSON(w, http.StatusOK, out)
}

// deletePack: one of the signed-in account's packs deleted
func (s *Server) deletePack(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	code := r.PathValue("code")
	if !packs.ValidCode(code) {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	if !s.packWrites.Allow(ss.AccountID, s.Now()) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	deleted, err := s.Store.DeletePack(r.Context(), code, ss.AccountID)
	if err != nil {
		s.log(r).Error("deleting a pack", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	s.public.browse[0].forget()
	s.public.browse[1].forget()
	s.log(r).Info("pack deleted", "code", code)
	w.WriteHeader(http.StatusNoContent)
}

// reportPack: the signed-in account's report of a pack (once per pack: again is the same report)
func (s *Server) reportPack(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	code := r.PathValue("code")
	if !packs.ValidCode(code) {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	if !s.packWrites.Allow(ss.AccountID, s.Now()) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	found, err := s.Store.ReportPack(r.Context(), code, ss.AccountID, s.Now())
	if err != nil {
		s.log(r).Error("reporting a pack", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not-found")
		return
	}
	s.log(r).Info("pack reported", "code", code)
	w.WriteHeader(http.StatusNoContent)
}
