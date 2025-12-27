package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type FavoriteHandler struct {
	favService *service.FavoriteService
}

func NewFavoriteHandler(favService *service.FavoriteService) *FavoriteHandler {
	return &FavoriteHandler{favService: favService}
}

type ToggleFavoriteRequest []service.FavoriteToggleItem

func (h *FavoriteHandler) Toggle(c echo.Context) error {
	var req ToggleFavoriteRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := c.Get("user_id").(string)

	if err := h.favService.ToggleFavorite(c.Request().Context(), userID, req); err != nil {
		return err
	}

	return c.NoContent(http.StatusOK)
}

func (h *FavoriteHandler) List(c echo.Context) error {
	userID := c.Get("user_id").(string)

	res, err := h.favService.ListFavorites(c.Request().Context(), userID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, res)
}
