package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type FavoriteHandler struct {
	favService *service.FavoriteService
}

func NewFavoriteHandler(favService *service.FavoriteService) *FavoriteHandler {
	return &FavoriteHandler{favService: favService}
}

func (h *FavoriteHandler) List(c echo.Context) error {
	favs, err := h.favService.List(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, favs)
}

type FavoriteRequest struct {
	Kind string `param:"kind" validate:"required,oneof=meme folder"`
	ID   string `param:"id" validate:"required,uuid"`
}

func (h *FavoriteHandler) Add(c echo.Context) error {
	var req FavoriteRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.favService.Add(c.Request().Context(), rbac.GetIdentity(c), req.Kind, req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *FavoriteHandler) Remove(c echo.Context) error {
	var req FavoriteRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.favService.Remove(c.Request().Context(), rbac.GetIdentity(c), req.Kind, req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *FavoriteHandler) ClearStale(c echo.Context) error {
	if err := h.favService.ClearStale(c.Request().Context(), rbac.GetIdentity(c)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
