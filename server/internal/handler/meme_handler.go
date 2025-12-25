package handler

import (
	"net/http"

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

	ownerID, _ := c.Get("user_id").(string)

	// If user is not logged in, scope must be global
	if ownerID == "" {
		req.Scope = "global"
	}

	results, err := h.memeService.Search(c.Request().Context(), service.SearchParams{
		Query:    req.Query,
		Limit:    req.Limit,
		Scope:    req.Scope,
		OwnerID:  ownerID,
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

	userID, _ := c.Get("user_id").(string)

	meme, err := h.memeService.GetMemeView(c.Request().Context(), req.ID, userID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, meme)
}

func (h *MemeHandler) Retry(c echo.Context) error {
	var req GetMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID, _ := c.Get("user_id").(string)

	if err := h.memeService.RetryProcessing(c.Request().Context(), req.ID, userID); err != nil {
		return err
	}

	return c.NoContent(http.StatusOK)
}

func (h *MemeHandler) Add(c echo.Context) error {
	var req GetMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID, _ := c.Get("user_id").(string)

	node, err := h.fsService.AddAssetToRoot(c.Request().Context(), userID, req.ID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, node)
}
