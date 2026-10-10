package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/model"
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

type AuthResponse struct {
	Token string      `json:"token"`
	User  *model.User `json:"user"`
}

func (h *AuthHandler) Register(c echo.Context) error {
	var req RegisterRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	token, user, err := h.authService.Register(c.Request().Context(), req.Username, req.Email, req.Password)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, AuthResponse{Token: token, User: user})
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

	token, user, err := h.authService.Login(c.Request().Context(), req.Email, req.Password)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) GetMe(c echo.Context) error {
	user, err := h.authService.GetUser(c.Request().Context(), Viewer(c).UserID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetMyStats(c echo.Context) error {
	stats, err := h.userService.Stats(c.Request().Context(), Viewer(c).UserID)
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

	err := h.authService.ChangePassword(c.Request().Context(), Viewer(c).UserID, req.CurrentPassword, req.NewPassword)
	if err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// IdentityProvider returns the AuthService as an rbac.IdentityProvider.
// Used to create the identity middleware.
func (h *AuthHandler) IdentityProvider() rbac.IdentityProvider {
	return h.authService
}
