package rbac

import (
	"context"
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

const identityKey = "rbac_identity"

type Authenticator interface {
	// Authenticate resolves a bearer credential; an error rejects the request.
	Authenticate(ctx context.Context, credential string) (*Identity, error)
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
			identity := &Identity{Role: RoleGuest}
			if credential, ok := strings.CutPrefix(c.Request().Header.Get("Authorization"), "Bearer "); ok {
				var err error
				if identity, err = auth.Authenticate(c.Request().Context(), credential); err != nil {
					return err
				}
			}

			c.Set(identityKey, identity)
			return next(c)
		}
	}
}

func RequireAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := GetIdentity(c)
			switch method := c.Request().Method; {
			case identity == nil || identity.UserID == "":
				return apperror.Unauthorized("unauthenticated", "sign in first")
			case identity.Scope == ScopeRead && method != http.MethodGet && method != http.MethodHead:
				return apperror.Forbidden("token_read_only", "this API token is read-only")
			}
			return next(c)
		}
	}
}

// RequireSession keeps account security, such as the password and the API tokens themselves, out of reach of API tokens.
func RequireSession() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if GetIdentity(c).Scope != "" {
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
