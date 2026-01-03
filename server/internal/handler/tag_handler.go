package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type TagHandler struct {
	tagService *service.TagService
}

func NewTagHandler(tagService *service.TagService) *TagHandler {
	return &TagHandler{tagService: tagService}
}

type AddTagRequest struct {
	MemeID string `param:"id" validate:"required,uuid"`
	Name   string `json:"name" validate:"required,min=1,max=50"`
}

type RemoveTagRequest struct {
	MemeID string `param:"id" validate:"required,uuid"`
	TagID  string `param:"tagId" validate:"required,uuid"`
}

type GetMemeTagsRequest struct {
	MemeID string `param:"id" validate:"required,uuid"`
}

type GetTagMemesRequest struct {
	TagID string `param:"id" validate:"required,uuid"`
}

type SearchTagsRequest struct {
	Query string `query:"q" validate:"omitempty,min=1"`
}

func (h *TagHandler) GetMemeTags(c echo.Context) error {
	var req GetMemeTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := GetUserID(c)

	tags, err := h.tagService.GetMemeTags(c.Request().Context(), userID, req.MemeID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, tags)
}

func (h *TagHandler) SearchTags(c echo.Context) error {
	var req SearchTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tags, err := h.tagService.SearchTags(c.Request().Context(), req.Query)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, tags)
}

func (h *TagHandler) GetTagMemes(c echo.Context) error {
	var req GetTagMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	userID := GetUserID(c)

	tag, memes, err := h.tagService.GetTagMemes(c.Request().Context(), userID, req.TagID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, echo.Map{
		"tag":   tag,
		"memes": memes,
	})
}

func (h *TagHandler) AddTag(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req AddTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tag, err := h.tagService.AddTagToMeme(c.Request().Context(), ownerID, req.MemeID, req.Name)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, tag)
}

func (h *TagHandler) RemoveTag(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req RemoveTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	err := h.tagService.RemoveTagFromMeme(c.Request().Context(), ownerID, req.MemeID, req.TagID)
	if err != nil {
		return err
	}

	return c.NoContent(http.StatusNoContent)
}
