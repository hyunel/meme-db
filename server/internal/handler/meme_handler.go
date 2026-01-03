package handler

import (
	"net/http"
	"path/filepath"

	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type MemeHandler struct {
	memeService  *service.MemeService
	assetService *service.AssetService
	fsService    *service.FileSystemService
}

func NewMemeHandler(memeService *service.MemeService, assetService *service.AssetService, fsService *service.FileSystemService) *MemeHandler {
	return &MemeHandler{
		memeService:  memeService,
		assetService: assetService,
		fsService:    fsService,
	}
}

type SearchRequest struct {
	Query    string `form:"q" validate:"omitempty"`
	Scope    string `form:"scope" validate:"omitempty,oneof=global my"`
	FolderID string `form:"folder_id" validate:"omitempty,uuid"`
	Limit    int    `form:"limit" validate:"omitempty,min=1"`
}

func (h *MemeHandler) Search(c echo.Context) error {
	var req SearchRequest

	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	ownerID := GetUserID(c)

	// If user is not logged in, scope must be global
	if ownerID == "" {
		req.Scope = "global"
	}

	var imgInput *inference.ImageInput
	file, err := c.FormFile("image")
	if err == nil {
		if _, err := h.assetService.ValidateUpload(file); err != nil {
			return err
		}

		src, err := file.Open()
		if err != nil {
			return err
		}
		defer src.Close()

		data := make([]byte, file.Size)
		if _, err := src.Read(data); err != nil {
			return err
		}

		imgInput = &inference.ImageInput{
			Data:   data,
			Format: filepath.Ext(file.Filename),
		}
	}

	results, err := h.memeService.Search(c.Request().Context(), service.SearchParams{
		Query:    req.Query,
		Image:    imgInput,
		Limit:    req.Limit,
		Scope:    req.Scope,
		UserID:   ownerID,
		FolderID: req.FolderID,
	})
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, results)
}

type GetMemeRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *MemeHandler) GetMeme(c echo.Context) error {
	var req GetMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := GetUserID(c)

	meme, err := h.memeService.GetMemeView(c.Request().Context(), userID, req.ID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, meme)
}

type GetSimilarMemesRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Limit int    `query:"limit" validate:"omitempty,min=1"`
}

func (h *MemeHandler) GetSimilar(c echo.Context) error {
	var req GetSimilarMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := GetUserID(c)

	results, err := h.memeService.GetSimilarMemes(c.Request().Context(), userID, req.ID, req.Limit)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, results)
}

type BatchRetryRequest struct {
	IDs []string `json:"ids" validate:"required,min=1,dive,uuid"`
}

func (h *MemeHandler) BatchRetry(c echo.Context) error {
	var req BatchRetryRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := MustGetUserID(c)

	if err := h.memeService.RetryProcessing(c.Request().Context(), userID, req.IDs); err != nil {
		return err
	}

	return c.NoContent(http.StatusOK)
}

func (h *MemeHandler) Add(c echo.Context) error {
	var req GetMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := MustGetUserID(c)

	node, err := h.fsService.AddAssetToRoot(c.Request().Context(), userID, req.ID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, node)
}
