//go:build !e2e

package server

import "net/http"

// e2eRoutes: none in the release build (internal/server/e2e.go: the browser tests' `e2e` build alone)
func (s *Server) e2eRoutes(*http.ServeMux) {}
