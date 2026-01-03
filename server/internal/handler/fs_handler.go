package handler

import (
	"mime/multipart"
	"net/http"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type FileSystemHandler struct {
	fsService *service.FileSystemService
}

func NewFileSystemHandler(fsService *service.FileSystemService) *FileSystemHandler {
	return &FileSystemHandler{fsService: fsService}
}

type CreateNodeRequest struct {
	ParentID *string        `json:"parent_id"`
	Name     string         `json:"name" validate:"required"`
	Type     model.NodeType `json:"type" validate:"required,oneof=FOLDER FILE"`
}

func (h *FileSystemHandler) CreateNode(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req CreateNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if req.ParentID != nil && *req.ParentID == "" {
		req.ParentID = nil
	}

	node, err := h.fsService.CreateNode(c.Request().Context(), ownerID, req.ParentID, req.Name, req.Type)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, node)
}

type GetNodeRequest struct {
	ID string `param:"id" validate:"omitempty"` // Optional: if empty, gets root
}

type GetNodeResponse struct {
	Node        *model.NodeView   `json:"node"`
	Children    []*model.NodeView `json:"children"`
	Breadcrumbs []*model.NodeView `json:"breadcrumbs"`
}

func (h *FileSystemHandler) GetNode(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req GetNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	result, err := h.fsService.GetNode(c.Request().Context(), ownerID, req.ID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, GetNodeResponse{
		Node:        result.Node,
		Children:    result.Children,
		Breadcrumbs: result.Breadcrumbs,
	})
}

type BulkUpdateNodeItem struct {
	ID         string            `json:"id" validate:"required"`
	Name       *string           `json:"name"`
	Visibility *model.Visibility `json:"visibility"`
}

type BulkUpdateNodesRequest struct {
	Items []BulkUpdateNodeItem `json:"items" validate:"required,gt=0"`
}

func (h *FileSystemHandler) BulkUpdateNodes(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req BulkUpdateNodesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	inputs := make([]service.BulkUpdateNodeInput, len(req.Items))
	for i, item := range req.Items {
		inputs[i] = service.BulkUpdateNodeInput{
			ID:         item.ID,
			Name:       item.Name,
			Visibility: item.Visibility,
		}
	}

	nodes, err := h.fsService.BulkUpdateNodes(c.Request().Context(), ownerID, inputs)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, nodes)
}

type BulkActionRequest struct {
	IDs          []string `json:"ids" validate:"required,gt=0"`
	DestParentID *string  `json:"dest_parent_id"`
}

func (h *FileSystemHandler) BulkDelete(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req BulkActionRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.fsService.BulkDeleteNodes(c.Request().Context(), ownerID, req.IDs); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *FileSystemHandler) BulkMove(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req BulkActionRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if req.DestParentID != nil && *req.DestParentID == "" {
		req.DestParentID = nil
	}

	if err := h.fsService.BulkMoveNodes(c.Request().Context(), ownerID, req.IDs, req.DestParentID); err != nil {
		return err
	}
	return c.NoContent(http.StatusOK)
}

func (h *FileSystemHandler) BulkCopy(c echo.Context) error {
	ownerID := MustGetUserID(c)
	var req BulkActionRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if req.DestParentID != nil && *req.DestParentID == "" {
		req.DestParentID = nil
	}

	if err := h.fsService.BulkCopyNodes(c.Request().Context(), ownerID, req.IDs, req.DestParentID); err != nil {
		return err
	}
	return c.NoContent(http.StatusCreated)
}

type UploadMemeRequest struct {
	ParentID *string               `form:"parent_id"`
	File     *multipart.FileHeader `form:"file" validate:"required"`
}

func (h *FileSystemHandler) UploadMeme(c echo.Context) error {
	var req UploadMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if req.ParentID != nil && *req.ParentID == "" {
		req.ParentID = nil
	}

	ownerID := MustGetUserID(c)

	node, err := h.fsService.UploadMeme(c.Request().Context(), ownerID, req.ParentID, req.File)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, node)
}
