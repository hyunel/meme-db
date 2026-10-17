package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type AuthHandler struct {
	authService *service.AuthService
	userService *service.UserService
}

func NewAuthHandler(authService *service.AuthService, userService *service.UserService) *AuthHandler {
	return &AuthHandler{authService: authService, userService: userService}
}

type RegisterRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50,username"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=6"`
}

func (h *AuthHandler) Register(c echo.Context) error {
	var req RegisterRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	signIn, err := h.authService.Register(c.Request().Context(), req.Username, req.Email, req.Password, c.Request().UserAgent(), c.RealIP())
	if err != nil {
		return err
	}
	rbac.SetSessionCookie(c, signIn.Secret, signIn.Expires)
	return c.JSON(http.StatusCreated, signIn.User)
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req LoginRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	signIn, err := h.authService.Login(c.Request().Context(), req.Email, req.Password, c.Request().UserAgent(), c.RealIP())
	if err != nil {
		return err
	}
	rbac.SetSessionCookie(c, signIn.Secret, signIn.Expires)
	return c.JSON(http.StatusOK, signIn.User)
}

func (h *AuthHandler) Logout(c echo.Context) error {
	if err := h.authService.Logout(c.Request().Context(), rbac.GetIdentity(c)); err != nil {
		return err
	}
	rbac.SetSessionCookie(c, "", time.Time{})
	return c.NoContent(http.StatusNoContent)
}

func (h *AuthHandler) GetMe(c echo.Context) error {
	user, expires, err := h.authService.Me(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	// The web app checks in here on each page load, so its cookie lapses with the session, which use keeps alive.
	if cookie, err := c.Cookie(rbac.SessionCookie); err == nil && !expires.IsZero() {
		rbac.SetSessionCookie(c, cookie.Value, expires)
	}
	return c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetMyStats(c echo.Context) error {
	stats, err := h.userService.Stats(c.Request().Context(), rbac.GetIdentity(c).UserID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, stats)
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	NewPassword     string `json:"new_password" validate:"required,min=6"`
}

func (h *AuthHandler) ChangePassword(c echo.Context) error {
	var req ChangePasswordRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	err := h.authService.ChangePassword(c.Request().Context(), rbac.GetIdentity(c), req.CurrentPassword, req.NewPassword)
	if err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *AuthHandler) ListSessions(c echo.Context) error {
	sessions, err := h.authService.Sessions(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, sessions)
}

type DeleteSessionsRequest struct {
	ID string `param:"id" validate:"omitempty,uuid"` // Omitted = all but the current one
}

func (h *AuthHandler) DeleteSessions(c echo.Context) error {
	var req DeleteSessionsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.authService.DeleteSessions(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *AuthHandler) ListTokens(c echo.Context) error {
	tokens, err := h.authService.ListTokens(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tokens)
}

type CreateTokenRequest struct {
	Name          string `json:"name"`
	Scope         string `json:"scope" validate:"required,oneof=read write admin"`
	ExpiresInDays int    `json:"expires_in_days" validate:"omitempty,min=1,max=3650"` // Omitted = never
}

type CreateTokenResponse struct {
	*model.APIToken
	Secret string `json:"secret"` // Only ever returned here
}

func (h *AuthHandler) CreateToken(c echo.Context) error {
	var req CreateTokenRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 50 {
		return apperror.BadRequest("invalid_name", "a name must be 1–50 characters").OnField("name").With("max", 50)
	}

	ttl := time.Duration(req.ExpiresInDays) * 24 * time.Hour
	token, secret, err := h.authService.CreateToken(c.Request().Context(), rbac.GetIdentity(c), name, req.Scope, ttl)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, CreateTokenResponse{APIToken: token, Secret: secret})
}

type TokenRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *AuthHandler) DeleteToken(c echo.Context) error {
	var req TokenRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.authService.DeleteToken(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
