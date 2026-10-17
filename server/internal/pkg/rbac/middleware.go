package rbac

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

const identityKey = "rbac_identity"

// SessionCookie holds the secret of a web sign-in.
const SessionCookie = "memedb_session"

type Authenticator interface {
	// Authenticate resolves an API token; an error rejects the request.
	Authenticate(ctx context.Context, token string) (*Identity, error)
	// Session resolves a session cookie; nil for one that has expired or been revoked.
	Session(ctx context.Context, secret string) (*Identity, error)
}

func GetIdentity(c echo.Context) *Identity {
	if v := c.Get(identityKey); v != nil {
		return v.(*Identity)
	}
	return nil
}

func IdentityMiddleware(auth Authenticator) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			identity := &Identity{Role: RoleGuest}
			var err error
			if token, ok := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer "); ok {
				identity, err = auth.Authenticate(req.Context(), token)
			} else if cookie, cerr := c.Cookie(SessionCookie); cerr == nil {
				// SameSite keeps the cookie off other sites' requests; this turns away the site's other origins, like a sibling subdomain.
				if site := req.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && req.Method != http.MethodGet && req.Method != http.MethodHead {
					return apperror.Forbidden("cross_site_request", "only this site's own pages may act with its session")
				}
				if identity, err = auth.Session(req.Context(), cookie.Value); identity == nil && err == nil {
					identity = &Identity{Role: RoleGuest, Lapsed: true}
				}
			}
			if err != nil {
				return err
			}

			c.Set(identityKey, identity)
			return next(c)
		}
	}
}

// SetSessionCookie keeps a session's secret out of reach of scripts, lapsing with the session; a zero expiry clears it.
func SetSessionCookie(c echo.Context, secret string, expires time.Time) {
	cookie := &http.Cookie{Name: SessionCookie, Value: secret, Path: "/", Expires: expires, HttpOnly: true, Secure: c.Scheme() == "https", SameSite: http.SameSiteLaxMode}
	if expires.IsZero() {
		cookie.MaxAge = -1
	}
	c.SetCookie(cookie)
}

func RequireAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := GetIdentity(c)
			switch method := c.Request().Method; {
			case identity == nil || identity.UserID == "":
				if identity != nil && identity.Lapsed {
					// Told once: the dead cookie goes, and later requests are a plain guest's.
					SetSessionCookie(c, "", time.Time{})
					return apperror.Unauthorized("session_expired", "the session has expired or been revoked; sign in again")
				}
				return apperror.Unauthorized("unauthenticated", "sign in first")
			case identity.Scope == ScopeRead && method != http.MethodGet && method != http.MethodHead:
				return apperror.Forbidden("token_read_only", "this API token is read-only")
			}
			return next(c)
		}
	}
}

// RequireSession keeps account security, such as the password, sign-ins and the API tokens themselves, out of reach of API tokens.
func RequireSession() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if GetIdentity(c).SessionID == "" {
				return apperror.Forbidden("session_required", "API tokens cannot do this; sign in on the web")
			}
			return next(c)
		}
	}
}

func RequireAdmin() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := GetIdentity(c)
			if identity.IsAdmin() {
				return next(c)
			}
			if identity.Role == RoleAdmin {
				return apperror.Forbidden("token_not_admin", "this API token lacks the admin scope")
			}
			return apperror.Forbidden("forbidden", "access denied")
		}
	}
}
