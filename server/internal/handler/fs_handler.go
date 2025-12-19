package handler

import (
	"mime/multipart"
	"net/http"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
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

	node, err := h.fsService.CreateNode(c.Request().Context(), ownerID, req.ParentID, req.Name, req.Type)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, node)
}

type GetNodeRequest struct {
	ID string `param:"id" validate:"required"`
}

func (h *FileSystemHandler) GetNode(c echo.Context) error {
	var req GetNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	node, err := h.fsService.GetNode(c.Request().Context(), req.ID)
	if err != nil {
		return err
	}

	// Permission check (if node is private and not owned by requester)
	ownerID := c.Get("user_id").(string)
	if node.Visibility == model.VisibilityPriv && node.OwnerID != ownerID {
		return apperror.Forbidden("permission denied")
	}

	res := map[string]interface{}{
		"node": node,
	}

	if node.Type == model.NodeTypeFolder {
		children, err := h.fsService.ListChildren(c.Request().Context(), req.ID, ownerID)
		if err == nil {
			res["children"] = children
		}
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

type DeleteNodeRequest struct {
	ID string `param:"id" validate:"required"`
}

func (h *FileSystemHandler) DeleteNode(c echo.Context) error {
	var req DeleteNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	ownerID := c.Get("user_id").(string)

	if err := h.fsService.DeleteNode(c.Request().Context(), req.ID, ownerID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type MoveNodeRequest struct {
	ID           string  `param:"id" validate:"required"`
	DestParentID *string `json:"dest_parent_id"`
}

func (h *FileSystemHandler) MoveNode(c echo.Context) error {
	ownerID := c.Get("user_id").(string)
	var req MoveNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.fsService.MoveNode(c.Request().Context(), req.ID, ownerID, req.DestParentID); err != nil {
		return err
	}
	return c.NoContent(http.StatusOK)
}

type CopyNodeRequest struct {
	ID           string `param:"id" validate:"required"`
	DestParentID string `json:"dest_parent_id" validate:"required"`
}

func (h *FileSystemHandler) CopyNode(c echo.Context) error {
	ownerID := c.Get("user_id").(string)
	var req CopyNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	newNode, err := h.fsService.CopyNode(c.Request().Context(), req.ID, ownerID, req.DestParentID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, newNode)
}

type UploadMemeRequest struct {
	ParentID string                `form:"parent_id" validate:"required"`
	File     *multipart.FileHeader `form:"file" validate:"required"`
}

func (h *FileSystemHandler) UploadMeme(c echo.Context) error {
	var req UploadMemeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	ownerID := c.Get("user_id").(string)

	node, err := h.fsService.UploadMeme(c.Request().Context(), ownerID, req.ParentID, req.File)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, node)
}
