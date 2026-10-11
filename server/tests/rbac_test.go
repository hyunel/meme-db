package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hyunel/MemeDB/internal/handler"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

// fakeAuth maps credentials to identities; unknown ones are rejected like a bad API token.
type fakeAuth map[string]*rbac.Identity

func (f fakeAuth) Authenticate(_ context.Context, credential string) (*rbac.Identity, error) {
	if id, ok := f[credential]; ok {
		return id, nil
	}
	return nil, apperror.Unauthorized("API 令牌无效、已过期或已被撤销")
}

// newServer mirrors the route groups of cmd/api.
func newServer() *echo.Echo {
	e := echo.New()
	e.HTTPErrorHandler = handler.HTTPErrorHandler
	e.Use(rbac.IdentityMiddleware(fakeAuth{
		"session":       {UserID: "u", Role: rbac.RoleUser},
		"read":          {UserID: "u", Role: rbac.RoleUser, Scope: rbac.ScopeRead},
		"write":         {UserID: "u", Role: rbac.RoleUser, Scope: rbac.ScopeWrite},
		"admin-session": {UserID: "a", Role: rbac.RoleAdmin},
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

		{"read", http.MethodPost, "/api/search", http.StatusNoContent},
		{"read", http.MethodGet, "/api/library", http.StatusNoContent},
		{"read", http.MethodPost, "/api/library/upload", http.StatusForbidden},
		{"write", http.MethodPost, "/api/library/upload", http.StatusNoContent},

		{"session", http.MethodGet, "/api/auth/tokens", http.StatusNoContent},
		{"write", http.MethodGet, "/api/auth/tokens", http.StatusForbidden},
		{"admin-admin", http.MethodGet, "/api/auth/tokens", http.StatusForbidden},

		{"session", http.MethodGet, "/api/admin/stats", http.StatusForbidden},
		{"admin-session", http.MethodGet, "/api/admin/stats", http.StatusNoContent},
		{"admin-write", http.MethodGet, "/api/admin/stats", http.StatusForbidden},
		{"admin-admin", http.MethodGet, "/api/admin/stats", http.StatusNoContent},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.credential != "" {
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
