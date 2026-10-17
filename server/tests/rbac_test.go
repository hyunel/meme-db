package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hyunel/MemeDB/internal/handler"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

// fakeAuth maps credentials to identities: unknown API tokens are rejected, unknown sessions have lapsed.
type fakeAuth map[string]*rbac.Identity

func (f fakeAuth) Authenticate(_ context.Context, token string) (*rbac.Identity, error) {
	if id, ok := f[token]; ok && id.Scope != "" {
		return id, nil
	}
	return nil, apperror.Unauthorized("invalid_token", "the API token is invalid, expired or revoked")
}

func (f fakeAuth) Session(_ context.Context, secret string) (*rbac.Identity, error) {
	if id, ok := f[secret]; ok && id.SessionID != "" {
		return id, nil
	}
	return nil, nil
}

// newServer mirrors the route groups of cmd/api.
func newServer() *echo.Echo {
	e := echo.New()
	e.HTTPErrorHandler = handler.HTTPErrorHandler
	e.Use(rbac.IdentityMiddleware(fakeAuth{
		"session":       {UserID: "u", Role: rbac.RoleUser, SessionID: "s"},
		"read":          {UserID: "u", Role: rbac.RoleUser, Scope: rbac.ScopeRead},
		"write":         {UserID: "u", Role: rbac.RoleUser, Scope: rbac.ScopeWrite},
		"admin-session": {UserID: "a", Role: rbac.RoleAdmin, SessionID: "s"},
		"admin-write":   {UserID: "a", Role: rbac.RoleAdmin, Scope: rbac.ScopeWrite},
		"admin-admin":   {UserID: "a", Role: rbac.RoleAdmin, Scope: rbac.ScopeAdmin},
	}))

	ok := func(c echo.Context) error { return c.NoContent(http.StatusNoContent) }
	api := e.Group("/api")
	api.POST("/search", ok)
	priv := api.Group("", rbac.RequireAuth())
	priv.GET("/library", ok)
	priv.POST("/library/upload", ok)
	priv.Group("/auth", rbac.RequireSession()).GET("/tokens", ok)
	priv.Group("/admin", rbac.RequireAdmin()).GET("/stats", ok)
	return e
}

func TestScopes(t *testing.T) {
	e := newServer()
	cases := []struct {
		credential, method, path string
		status                   int
	}{
		{"", http.MethodPost, "/api/search", http.StatusNoContent},
		{"", http.MethodGet, "/api/library", http.StatusUnauthorized},
		{"bogus", http.MethodPost, "/api/search", http.StatusUnauthorized},
		{"session:lapsed", http.MethodPost, "/api/search", http.StatusNoContent},
		{"session:lapsed", http.MethodGet, "/api/library", http.StatusUnauthorized},

		{"read", http.MethodPost, "/api/search", http.StatusNoContent},
		{"read", http.MethodGet, "/api/library", http.StatusNoContent},
		{"read", http.MethodPost, "/api/library/upload", http.StatusForbidden},
		{"write", http.MethodPost, "/api/library/upload", http.StatusNoContent},

		{"session:session", http.MethodGet, "/api/auth/tokens", http.StatusNoContent},
		{"write", http.MethodGet, "/api/auth/tokens", http.StatusForbidden},
		{"admin-admin", http.MethodGet, "/api/auth/tokens", http.StatusForbidden},

		{"session:session", http.MethodGet, "/api/admin/stats", http.StatusForbidden},
		{"session:admin-session", http.MethodGet, "/api/admin/stats", http.StatusNoContent},
		{"admin-write", http.MethodGet, "/api/admin/stats", http.StatusForbidden},
		{"admin-admin", http.MethodGet, "/api/admin/stats", http.StatusNoContent},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		// A "session:" credential is a session cookie's secret, any other an API token.
		if secret, ok := strings.CutPrefix(tc.credential, "session:"); ok {
			req.AddCookie(&http.Cookie{Name: rbac.SessionCookie, Value: secret})
		} else if tc.credential != "" {
			req.Header.Set("Authorization", "Bearer "+tc.credential)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, tc.status, rec.Code, "%s %s as %q", tc.method, tc.path, tc.credential)
	}
}

func TestIsAdmin(t *testing.T) {
	assert.True(t, (&rbac.Identity{Role: rbac.RoleAdmin}).IsAdmin())
	assert.True(t, (&rbac.Identity{Role: rbac.RoleAdmin, Scope: rbac.ScopeAdmin}).IsAdmin())
	assert.False(t, (&rbac.Identity{Role: rbac.RoleAdmin, Scope: rbac.ScopeWrite}).IsAdmin())
	assert.False(t, (&rbac.Identity{Role: rbac.RoleUser, Scope: rbac.ScopeAdmin}).IsAdmin())
	assert.False(t, (*rbac.Identity)(nil).IsAdmin())
}
