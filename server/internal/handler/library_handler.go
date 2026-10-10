package handler

import (
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type LibraryHandler struct {
	libraryService *service.LibraryService
}

func NewLibraryHandler(libraryService *service.LibraryService) *LibraryHandler {
	return &LibraryHandler{libraryService: libraryService}
}

// nodeName validates a folder or file name.
func nodeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 255 {
		return "", apperror.BadRequest("名称需为 1–255 个字符").OnField("name")
	}
	return name, nil
}

type GetLibraryRequest struct {
	FolderID string `query:"folder_id" validate:"omitempty,uuid"`
}

func (h *LibraryHandler) Get(c echo.Context) error {
	var req GetLibraryRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	view, err := h.libraryService.Get(c.Request().Context(), Viewer(c), optionalID(req.FolderID))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, view)
}

type CreateFolderRequest struct {
	ParentID string `json:"parent_id" validate:"omitempty,uuid"`
	Name     string `json:"name"`
}

func (h *LibraryHandler) CreateFolder(c echo.Context) error {
	var req CreateFolderRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	name, err := nodeName(req.Name)
	if err != nil {
		return err
	}

	folder, err := h.libraryService.CreateFolder(c.Request().Context(), Viewer(c), optionalID(req.ParentID), name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, folder)
}

type UploadRequest struct {
	ParentID string                `form:"parent_id" validate:"omitempty,uuid"`
	File     *multipart.FileHeader `form:"file" validate:"required"`
}

func (h *LibraryHandler) Upload(c echo.Context) error {
	var req UploadRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	entry, err := h.libraryService.Upload(c.Request().Context(), Viewer(c), optionalID(req.ParentID), req.File)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, entry)
}

type AddEntryRequest struct {
	MemeID   string `json:"meme_id" validate:"required,uuid"`
	ParentID string `json:"parent_id" validate:"omitempty,uuid"`
}

// AddEntry adds an existing meme to the library.
func (h *LibraryHandler) AddEntry(c echo.Context) error {
	var req AddEntryRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	entry, err := h.libraryService.AddMeme(c.Request().Context(), Viewer(c), req.MemeID, optionalID(req.ParentID))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, entry)
}

type RenameNodeRequest struct {
	ID   string `param:"id" validate:"required,uuid"`
	Name string `json:"name"`
}

func (h *LibraryHandler) Rename(c echo.Context) error {
	var req RenameNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	name, err := nodeName(req.Name)
	if err != nil {
		return err
	}

	if err := h.libraryService.Rename(c.Request().Context(), Viewer(c), req.ID, name); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type SetPublicRequest struct {
	IDs      []string `json:"ids" validate:"required,min=1,max=500,dive,uuid"`
	IsPublic *bool    `json:"is_public" validate:"required"`
}

func (h *LibraryHandler) SetPublic(c echo.Context) error {
	var req SetPublicRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.libraryService.SetPublic(c.Request().Context(), Viewer(c), req.IDs, *req.IsPublic); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type NodesRequest struct {
	IDs []string `json:"ids" validate:"required,min=1,max=500,dive,uuid"`
}

func (h *LibraryHandler) Delete(c echo.Context) error {
	var req NodesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.libraryService.Delete(c.Request().Context(), Viewer(c), req.IDs); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type TransferRequest struct {
	IDs      []string `json:"ids" validate:"required,min=1,max=500,dive,uuid"`
	TargetID string   `json:"target_id" validate:"omitempty,uuid"` // Empty = the root
}

func (h *LibraryHandler) Move(c echo.Context) error {
	var req TransferRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.libraryService.Move(c.Request().Context(), Viewer(c), req.IDs, optionalID(req.TargetID)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *LibraryHandler) Copy(c echo.Context) error {
	var req TransferRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.libraryService.Copy(c.Request().Context(), Viewer(c), req.IDs, optionalID(req.TargetID)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// ==============================================================================
// Public views
// ==============================================================================

type PublicFoldersRequest struct {
	Limit int `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *LibraryHandler) PublicFolders(c echo.Context) error {
	var req PublicFoldersRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	folders, err := h.libraryService.PublicFolders(c.Request().Context(), Viewer(c), limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, folders)
}

type PublicFolderRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *LibraryHandler) PublicFolder(c echo.Context) error {
	var req PublicFolderRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.libraryService.PublicFolder(c.Request().Context(), Viewer(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

type ProfileRequest struct {
	Username string `param:"username" validate:"required,max=50"`
}

func (h *LibraryHandler) Profile(c echo.Context) error {
	var req ProfileRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	profile, err := h.libraryService.Profile(c.Request().Context(), Viewer(c), req.Username)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, profile)
}
