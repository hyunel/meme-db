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
	Hash string `param:"hash" validate:"required,len=64,hexadecimal"`
}

func (h *AssetHandler) GetAssetContent(c echo.Context) error {
	var req GetAssetContentRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	asset, content, err := h.assetService.Content(c.Request().Context(), req.Hash)
	if err != nil {
		return err
	}
	defer content.Close()

	// Assets are immutable and content-addressed, so the hash is a strong ETag; ServeContent answers If-None-Match and Range.
	c.Response().Header().Set("ETag", `"`+asset.FileHash+`"`)
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	c.Response().Header().Set("Content-Type", asset.MimeType)
	http.ServeContent(c.Response(), c.Request(), "", asset.CreatedAt, content)
	return nil
}

func (h *AssetHandler) GetConfig(c echo.Context) error {
	return c.JSON(http.StatusOK, echo.Map{"upload": h.assetService.UploadConfig()})
}
