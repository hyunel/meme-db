package rbac

import (
	"context"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

const identityKey = "rbac_identity"

type IdentityProvider interface {
	ParseToken(token string) (userID string, err error)
	GetIdentity(ctx context.Context, userID string) (*Identity, error)
}

func GetIdentity(c echo.Context) *Identity {
	if v := c.Get(identityKey); v != nil {
		return v.(*Identity)
	}
	return nil
}

func IdentityMiddleware(provider IdentityProvider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			identity := &Identity{Role: RoleGuest}
			if token, ok := strings.CutPrefix(c.Request().Header.Get("Authorization"), "Bearer "); ok {
				if userID, err := provider.ParseToken(token); err == nil && userID != "" {
					if id, err := provider.GetIdentity(c.Request().Context(), userID); err == nil {
						identity = id
					}
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
			if identity := GetIdentity(c); identity == nil || identity.UserID == "" {
				return apperror.Unauthorized("请先登录")
			}
			return next(c)
		}
	}
}

func RequireAdmin() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !GetIdentity(c).IsAdmin() {
				return apperror.Forbidden("没有访问权限")
			}
			return next(c)
		}
	}
}
