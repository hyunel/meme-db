package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type TagHandler struct {
	tagService *service.TagService
}

func NewTagHandler(tagService *service.TagService) *TagHandler {
	return &TagHandler{tagService: tagService}
}

type ListTagsRequest struct {
	Scope *model.TagScope `query:"scope"`
}

func (h *TagHandler) ListTags(c echo.Context) error {
	var req ListTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tags, err := h.tagService.ListTags(c.Request().Context(), req.Scope)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tags)
}

type CreateTagRequest struct {
	Name string         `json:"name" validate:"required"`
	Type model.TagScope `json:"type" validate:"required,oneof=USER SYSTEM"`
}

func (h *TagHandler) CreateTag(c echo.Context) error {
	var req CreateTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tag, err := h.tagService.CreateTag(c.Request().Context(), req.Name, req.Type)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, tag)
}

type UpdateTagRequest struct {
	ID   string `param:"id" validate:"required"`
	Name string `json:"name" validate:"required"`
}

func (h *TagHandler) UpdateTag(c echo.Context) error {
	var req UpdateTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	tag, err := h.tagService.UpdateTag(c.Request().Context(), req.ID, req.Name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tag)
}

type DeleteTagRequest struct {
	ID string `param:"id" validate:"required"`
}

func (h *TagHandler) DeleteTag(c echo.Context) error {
	var req DeleteTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.DeleteTag(c.Request().Context(), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type AddTagToNodeRequest struct {
	NodeID string `param:"nodeId" validate:"required"`
	TagID  string `json:"tag_id" validate:"required"`
}

func (h *TagHandler) AddTagToNode(c echo.Context) error {
	var req AddTagToNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.AddTagToNode(c.Request().Context(), req.NodeID, req.TagID); err != nil {
		return err
	}
	return c.NoContent(http.StatusOK)
}

type RemoveTagFromNodeRequest struct {
	NodeID string `param:"nodeId" validate:"required"`
	TagID  string `param:"tagId" validate:"required"`
}

func (h *TagHandler) RemoveTagFromNode(c echo.Context) error {
	var req RemoveTagFromNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.RemoveTagFromNode(c.Request().Context(), req.NodeID, req.TagID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
