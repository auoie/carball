package server

import (
	"context"
	"log/slog"
	"net/http"
)

// who is a request's client as the log's lines name it (the user's decision of 2026-10-23: the lines say who and
// where, for abuse and debugging): its address (CF-Connecting-IP from the tunnel's connection, TRUSTED_PROXIES; else the
// connection's), and its account's id and display name once its session is read. Never a credential: no cookie, ticket,
// search id, OAuth code or token, secret or e-mail
type who struct {
	ip, account, name string
}

type whoKey struct{}

// whoOf: the request's client (nil outside the access log's middleware: a test's bare handler call)
func whoOf(r *http.Request) *who {
	w, _ := r.Context().Value(whoKey{}).(*who)
	return w
}

// withWho: the request with its client noted
func withWho(r *http.Request, w *who) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), whoKey{}, w))
}

// signedIn notes the request's account
func (w *who) signedIn(account, name string) {
	if w != nil {
		w.account, w.name = account, name
	}
}

// attrs: the client as log attributes
func (w *who) attrs() []any {
	if w == nil {
		return nil
	}
	attrs := []any{"ip", w.ip}
	if w.account != "" {
		attrs = append(attrs, "account", w.account, "name", w.name)
	}
	return attrs
}

// log: the service's logger, its lines naming the request's client
func (s *Server) log(r *http.Request) *slog.Logger {
	return s.Log.With(whoOf(r).attrs()...)
}
