package handler

import (
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
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
	Limit    int                   `form:"limit" validate:"omitempty,min=1,max=100"`
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
		Viewer:   Viewer(c),
		Query:    req.Query,
		Mine:     req.Scope == "mine",
		FolderID: req.FolderID,
		Limit:    req.Limit,
	}
	if req.Image != nil {
		image, err := readSearchImage(req.Image)
		if err != nil {
			return err
		}
		params.Image = image
	}

	results, err := h.memeService.Search(c.Request().Context(), params)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, results)
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
	Tag   string `query:"tag" validate:"max=100"`
	Limit int    `query:"limit" validate:"omitempty,min=1,max=100"`
}

// List lists the memes the viewer may see, most popular first.
func (h *MemeHandler) List(c echo.Context) error {
	var req ListMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.memeService.Popular(c.Request().Context(), Viewer(c), req.Tag, limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

type MemeRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *MemeHandler) Get(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	meme, err := h.memeService.Get(c.Request().Context(), Viewer(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, meme)
}

type SimilarMemesRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Limit int    `query:"limit" validate:"omitempty,min=1,max=50"`
}

func (h *MemeHandler) Similar(c echo.Context) error {
	var req SimilarMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	memes, err := h.memeService.Similar(c.Request().Context(), Viewer(c), req.ID, limitOr(req.Limit, 10))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, memes)
}

func (h *MemeHandler) Retry(c echo.Context) error {
	var req MemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.memeService.Retry(c.Request().Context(), Viewer(c), req.ID); err != nil {
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

	tag, err := h.tagService.AddToMeme(c.Request().Context(), Viewer(c), req.MemeID, name)
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

	if err := h.tagService.RemoveFromMeme(c.Request().Context(), Viewer(c), req.MemeID, req.TagID); err != nil {
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

	tags, err := h.tagService.Hot(c.Request().Context(), Viewer(c), limitOr(req.Limit, 10))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tags)
}
