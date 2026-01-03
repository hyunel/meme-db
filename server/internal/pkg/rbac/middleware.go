package rbac

import (
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

const (
	// EchoIdentityKey is the key used to store identity in echo.Context
	EchoIdentityKey = "rbac_identity"
)

// IdentityProvider is the interface for loading user identity.
// Implemented by AuthService.
type IdentityProvider interface {
	ParseToken(token string) (userID string, err error)
	GetIdentity(userID string) (*Identity, error)
}

// GetIdentity retrieves the identity from echo.Context.
func GetIdentity(c echo.Context) *Identity {
	if v := c.Get(EchoIdentityKey); v != nil {
		return v.(*Identity)
	}
	return nil
}

// SetIdentity sets the identity in echo.Context.
func SetIdentity(c echo.Context, identity *Identity) {
	c.Set(EchoIdentityKey, identity)
}

// IdentityMiddleware parses the JWT token and sets the identity in context.
// It always sets an identity (guest or authenticated) for downstream handlers.
func IdentityMiddleware(provider IdentityProvider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Try to extract and validate token
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader != "" {
				parts := strings.Split(authHeader, " ")
				if len(parts) == 2 && parts[0] == "Bearer" {
					userID, err := provider.ParseToken(parts[1])
					if err == nil && userID != "" {
						identity, err := provider.GetIdentity(userID)
						if err == nil {
							SetIdentity(c, identity)
							return next(c)
						}
					}
				}
			}

			// No valid token - set guest identity
			SetIdentity(c, GuestIdentity())
			return next(c)
		}
	}
}

// RequireAuth creates a middleware that requires authentication.
func RequireAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := GetIdentity(c)
			if identity == nil || !identity.IsAuthenticated() {
				return apperror.Unauthorized("authentication required")
			}
			return next(c)
		}
	}
}

// RequireLevel creates a middleware that requires a minimum role level.
func RequireLevel(level int) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := GetIdentity(c)
			if identity == nil || !identity.AtLeast(level) {
				return apperror.Forbidden("insufficient permissions")
			}
			return next(c)
		}
	}
}

// RequireAdmin is a convenience middleware that requires admin level.
func RequireAdmin() echo.MiddlewareFunc {
	return RequireLevel(LevelAdmin)
}
