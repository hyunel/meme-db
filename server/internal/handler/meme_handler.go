package handler

import (
	"mime/multipart"
	"net/http"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type MemeHandler struct {
	memeService *service.MemeService
}

func NewMemeHandler(memeService *service.MemeService) *MemeHandler {
	return &MemeHandler{
		memeService: memeService,
	}
}

type IngestMemeRequest struct {
	File *multipart.FileHeader `form:"file" validate:"required"`
}

func (h *MemeHandler) IngestMeme(c echo.Context) error {
	var req IngestMemeRequest

	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	// TODO: Limit file size, type, etc.

	asset, err := h.memeService.IngestMeme(c.Request().Context(), req.File)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, asset)
}

type SearchRequest struct {
	Query    string `query:"q" validate:"required"`
	Scope    string `query:"scope" validate:"omitempty,oneof=global my"`
	FolderID string `query:"folder_id"`
	Limit    int    `query:"limit" validate:"omitempty,min=1"`
}

func (h *MemeHandler) Search(c echo.Context) error {
	var req SearchRequest

	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	limit := req.Limit
	if limit == 0 {
		limit = 10
	}

	ownerID := c.Get("user_id").(string)

	// Use FullSearch which uses the internal inferClient
	// We need to pass scope and ownerID to filter results
	results, err := h.memeService.FullSearch(c.Request().Context(), req.Query, limit, req.Scope, ownerID, req.FolderID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, results)
}
