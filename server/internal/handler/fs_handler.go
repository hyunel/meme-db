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
	ownerID := c.Get("user_id").(string)
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

func (h *FileSystemHandler) GetNode(c echo.Context) error {
	ownerID := c.Get("user_id").(string)
	var req GetNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	res, err := h.fsService.GetNode(c.Request().Context(), req.ID, ownerID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, res)
}

type UpdateNodeRequest struct {
	ID         string            `param:"id" validate:"required"`
	Name       *string           `json:"name"`
	Visibility *model.Visibility `json:"visibility"`
	IsFavorite *bool             `json:"is_favorite"`
}

func (h *FileSystemHandler) UpdateNode(c echo.Context) error {
	ownerID := c.Get("user_id").(string)
	var req UpdateNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	input := service.UpdateNodeInput{
		Name:       req.Name,
		Visibility: req.Visibility,
		IsFavorite: req.IsFavorite,
	}

	node, err := h.fsService.UpdateNode(c.Request().Context(), req.ID, ownerID, input)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, node)
}

type BulkActionRequest struct {
	IDs          []string `json:"ids" validate:"required,gt=0"`
	DestParentID *string  `json:"dest_parent_id"`
}

func (h *FileSystemHandler) BulkDelete(c echo.Context) error {
	ownerID := c.Get("user_id").(string)
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
	ownerID := c.Get("user_id").(string)
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
	ownerID := c.Get("user_id").(string)
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

	ownerID := c.Get("user_id").(string)

	node, err := h.fsService.UploadMeme(c.Request().Context(), ownerID, req.ParentID, req.File)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, node)
}
