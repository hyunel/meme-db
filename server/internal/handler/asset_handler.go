package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type AssetHandler struct {
	assetService *service.AssetService
}

func NewAssetHandler(assetService *service.AssetService) *AssetHandler {
	return &AssetHandler{assetService: assetService}
}

type GetAssetContentRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Token string `query:"token" validate:"required"`
}

func (h *AssetHandler) GetAssetContent(c echo.Context) error {
	var req GetAssetContentRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	asset, path, err := h.assetService.Content(c.Request().Context(), req.ID, req.Token)
	if err != nil {
		return err
	}

	// Assets are immutable and content-addressed, so the hash is a strong ETag.
	etag := `"` + asset.FileHash + `"`
	if c.Request().Header.Get("If-None-Match") == etag {
		return c.NoContent(http.StatusNotModified)
	}
	c.Response().Header().Set("ETag", etag)
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	c.Response().Header().Set("Content-Type", asset.MimeType)
	return c.File(path)
}

// GetConfig returns the settings clients need, such as upload limits.
func (h *AssetHandler) GetConfig(c echo.Context) error {
	return c.JSON(http.StatusOK, echo.Map{"upload": h.assetService.UploadConfig()})
}
