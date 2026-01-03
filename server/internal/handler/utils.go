package handler

import (
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/labstack/echo/v4"
)

func BindAndValidate(c echo.Context, req interface{}) error {
	if err := c.Bind(req); err != nil {
		return apperror.BadRequest(err.Error())
	}

	if err := c.Validate(req); err != nil {
		return apperror.BadRequest(err.Error())
	}

	return nil
}

// GetUserID returns the authenticated user's ID from context, or empty string for guests.
func GetUserID(c echo.Context) string {
	identity := rbac.GetIdentity(c)
	if identity == nil {
		return ""
	}
	return identity.UserID
}

// MustGetUserID returns the authenticated user's ID, panics if not authenticated.
// Use only after RequireAuth middleware.
func MustGetUserID(c echo.Context) string {
	identity := rbac.GetIdentity(c)
	if identity == nil || identity.UserID == "" {
		panic("MustGetUserID called without authentication")
	}
	return identity.UserID
}
