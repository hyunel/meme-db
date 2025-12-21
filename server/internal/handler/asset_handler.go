package handler

import (
	"net/http"
	"path/filepath"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type AssetHandler struct {
	cfg       *config.Config
	fsService *service.FileSystemService
}

func NewAssetHandler(cfg *config.Config, fsService *service.FileSystemService) *AssetHandler {
	return &AssetHandler{
		cfg:       cfg,
		fsService: fsService,
	}
}

func (h *AssetHandler) GetAssetContent(c echo.Context) error {
	id := c.Param("id")
	token := c.QueryParam("token")

	asset, err := h.fsService.GetAssetForContent(c.Request().Context(), id, token)
	if err != nil {
		return err
	}

	// Support ETag using the pre-calculated file hash from database
	etag := `"` + asset.FileHash + `"`
	if c.Request().Header.Get("If-None-Match") == etag {
		return c.NoContent(http.StatusNotModified)
	}

	absPath := filepath.Join(h.cfg.Server.StoragePath, asset.StoragePath)

	// Set cache headers for better performance since assets are immutable
	c.Response().Header().Set("ETag", etag)
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000") // 1 year
	c.Response().Header().Set("Content-Type", asset.MimeType)

	return c.File(absPath)
}
