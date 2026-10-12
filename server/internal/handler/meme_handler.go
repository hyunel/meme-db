package handler

import (
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

const maxSearchImageBytes = 10 << 20

type MemeHandler struct {
	memeService *service.MemeService
	tagService  *service.TagService
}

func NewMemeHandler(memeService *service.MemeService, tagService *service.TagService) *MemeHandler {
	return &MemeHandler{memeService: memeService, tagService: tagService}
}

type SearchRequest struct {
	Query    string                `form:"q" validate:"max=200"`
	Scope    string                `form:"scope" validate:"omitempty,oneof=all mine"`
	FolderID string                `form:"folder_id" validate:"omitempty,uuid"`
	Page     int                   `form:"page" validate:"min=0"` // Resumes a search whose cursor expired
	Image    *multipart.FileHeader `form:"image"`
}

func (h *MemeHandler) Search(c echo.Context) error {
	var req SearchRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" && req.Image == nil {
		return apperror.BadRequest("请输入关键词或添加图片")
	}

	params := service.SearchParams{
		Viewer:   rbac.GetIdentity(c),
		Query:    req.Query,
		Mine:     req.Scope == "mine",
		FolderID: req.FolderID,
		Page:     req.Page,
	}
	if req.Image != nil {
		image, err := readSearchImage(req.Image)
		if err != nil {
			return err
		}
		params.Image = image
	}

	feed, err := h.memeService.Search(c.Request().Context(), params)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}

type SearchPageRequest struct {
	Cursor string `query:"cursor" validate:"required,max=64"`
}

func (h *MemeHandler) SearchPage(c echo.Context) error {
	var req SearchPageRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	feed, err := h.memeService.SearchPage(c.Request().Context(), rbac.GetIdentity(c), req.Cursor)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}

func readSearchImage(fileHeader *multipart.FileHeader) (*inference.ImageInput, error) {
	if fileHeader.Size > maxSearchImageBytes {
		return nil, apperror.BadRequest("图片不能超过 10 MB")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxSearchImageBytes))
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(http.DetectContentType(data), "image/") {
		return nil, apperror.BadRequest("仅支持按图片搜索")
	}
	return &inference.ImageInput{Data: data, Format: filepath.Ext(fileHeader.Filename)}, nil
}

type ListMemesRequest struct {
	Tag    string `query:"tag" validate:"max=100"`
	Cursor string `query:"cursor" validate:"max=64"`
	Limit  int    `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *MemeHandler) List(c echo.Context) error {
	var req ListMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	feed, err := h.memeService.Popular(c.Request().Context(), rbac.GetIdentity(c), req.Tag, req.Cursor, limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}

type StatsResponse struct {
	Memes int `json:"memes"` // Analyzed memes, public or not
}

func (h *MemeHandler) Stats(c echo.Context) error {
	n, err := h.memeService.Count(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, StatsResponse{Memes: n})
}

type MemeRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

type GetMemeRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Share string `query:"share" validate:"omitempty,uuid"` // A private link
}

func (h *MemeHandler) Get(c echo.Context) error {
	var req GetMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	meme, err := h.memeService.Get(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, meme)
}

type SimilarMemesRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Share string `query:"share" validate:"omitempty,uuid"`
	Page  int    `query:"cursor" validate:"min=0"` // The cursor of similar memes is the page number
}

func (h *MemeHandler) Similar(c echo.Context) error {
	var req SimilarMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	feed, err := h.memeService.Similar(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share, req.Page)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}

func (h *MemeHandler) Retry(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.memeService.Retry(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ShareLink returns the viewer's private link to the meme, or null.
func (h *MemeHandler) ShareLink(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	link, err := h.memeService.ShareLink(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, link)
}

func (h *MemeHandler) CreateShareLink(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	link, err := h.memeService.CreateShareLink(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, link)
}

func (h *MemeHandler) ShareLinks(c echo.Context) error {
	links, err := h.memeService.ShareLinks(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, links)
}

type ViewShareLinkRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Share string `json:"share" validate:"required,uuid"`
}

// ViewShareLink counts a page load of a meme opened by a private link; the page reports it once, unlike its refetches.
func (h *MemeHandler) ViewShareLink(c echo.Context) error {
	var req ViewShareLinkRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.memeService.ViewShareLink(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *MemeHandler) DeleteShareLink(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.memeService.DeleteShareLink(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type AddTagRequest struct {
	MemeID string `param:"id" validate:"required,uuid"`
	Name   string `json:"name" validate:"required"`
}

func (h *MemeHandler) AddTag(c echo.Context) error {
	var req AddTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	name := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(req.Name), "#"))
	if name == "" || len([]rune(name)) > 50 {
		return apperror.BadRequest("标签需为 1–50 个字符")
	}

	tag, err := h.tagService.AddToMeme(c.Request().Context(), rbac.GetIdentity(c), req.MemeID, name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, tag)
}

type RemoveTagRequest struct {
	MemeID string `param:"id" validate:"required,uuid"`
	TagID  string `param:"tagId" validate:"required,uuid"`
}

func (h *MemeHandler) RemoveTag(c echo.Context) error {
	var req RemoveTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.RemoveFromMeme(c.Request().Context(), rbac.GetIdentity(c), req.MemeID, req.TagID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type HotTagsRequest struct {
	Limit int `query:"limit" validate:"omitempty,min=1,max=50"`
}

func (h *MemeHandler) HotTags(c echo.Context) error {
	var req HotTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tags, err := h.tagService.Hot(c.Request().Context(), rbac.GetIdentity(c), limitOr(req.Limit, 10))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tags)
}
