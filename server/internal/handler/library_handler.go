package handler

import (
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type LibraryHandler struct {
	libraryService *service.LibraryService
}

func NewLibraryHandler(libraryService *service.LibraryService) *LibraryHandler {
	return &LibraryHandler{libraryService: libraryService}
}

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

	view, err := h.libraryService.Get(c.Request().Context(), rbac.GetIdentity(c), optionalID(req.FolderID))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, view)
}

func (h *LibraryHandler) FolderTree(c echo.Context) error {
	folders, err := h.libraryService.FolderTree(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, folders)
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

	folder, err := h.libraryService.CreateFolder(c.Request().Context(), rbac.GetIdentity(c), optionalID(req.ParentID), name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, folder)
}

type UploadRequest struct {
	ParentID string                `form:"parent_id" validate:"omitempty,uuid"`
	Path     string                `form:"path"` // Folders under the parent to put the file in, such as "a/b"
	Tags     []string              `form:"tag"`  // The uploader's own tags, the field repeated for each
	File     *multipart.FileHeader `form:"file" validate:"required"`
}

func (h *LibraryHandler) Upload(c echo.Context) error {
	var req UploadRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	path := strings.FieldsFunc(req.Path, func(r rune) bool { return r == '/' })
	for i, segment := range path {
		name, err := nodeName(segment)
		if err != nil {
			return apperror.BadRequest("路径中的文件夹名称需为 1–255 个字符").OnField("path")
		}
		path[i] = name
	}
	for i, tag := range req.Tags {
		name, err := tagName(tag)
		if err != nil {
			return err
		}
		req.Tags[i] = name
	}

	entry, created, err := h.libraryService.Upload(c.Request().Context(), rbac.GetIdentity(c), optionalID(req.ParentID), path, req.Tags, req.File)
	if err != nil {
		return err
	}
	return entryResponse(c, entry, created)
}

type AddEntryRequest struct {
	MemeID   string `json:"meme_id" validate:"required,uuid"`
	ParentID string `json:"parent_id" validate:"omitempty,uuid"`
	Share    string `json:"share" validate:"omitempty,uuid"` // A private link the meme was opened by
}

func (h *LibraryHandler) AddEntry(c echo.Context) error {
	var req AddEntryRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	entry, created, err := h.libraryService.AddMeme(c.Request().Context(), rbac.GetIdentity(c), req.MemeID, optionalID(req.ParentID), req.Share)
	if err != nil {
		return err
	}
	return entryResponse(c, entry, created)
}

// The entry already in the folder comes back with 200 rather than 201.
func entryResponse(c echo.Context, entry *service.EntryDetail, created bool) error {
	if created {
		return c.JSON(http.StatusCreated, entry)
	}
	return c.JSON(http.StatusOK, entry)
}

type SaveFolderRequest struct {
	ID       string `param:"id" validate:"required,uuid"`
	ParentID string `json:"parent_id" validate:"omitempty,uuid"`
	Share    string `json:"share" validate:"omitempty,uuid"` // A private link the folder was opened by
}

// SaveFolder copies another user's folder into the viewer's library.
func (h *LibraryHandler) SaveFolder(c echo.Context) error {
	var req SaveFolderRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	folder, err := h.libraryService.SaveFolder(c.Request().Context(), rbac.GetIdentity(c), req.ID, optionalID(req.ParentID), req.Share)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, folder)
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

	if err := h.libraryService.Rename(c.Request().Context(), rbac.GetIdentity(c), req.ID, name); err != nil {
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

	if err := h.libraryService.SetPublic(c.Request().Context(), rbac.GetIdentity(c), req.IDs, *req.IsPublic); err != nil {
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

	if err := h.libraryService.Delete(c.Request().Context(), rbac.GetIdentity(c), req.IDs); err != nil {
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

	if err := h.libraryService.Move(c.Request().Context(), rbac.GetIdentity(c), req.IDs, optionalID(req.TargetID)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *LibraryHandler) Copy(c echo.Context) error {
	var req TransferRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.libraryService.Copy(c.Request().Context(), rbac.GetIdentity(c), req.IDs, optionalID(req.TargetID)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type PublicFoldersRequest struct {
	Limit int `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *LibraryHandler) PublicFolders(c echo.Context) error {
	var req PublicFoldersRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	folders, err := h.libraryService.PublicFolders(c.Request().Context(), rbac.GetIdentity(c), limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, folders)
}

type MemeFoldersRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Limit int    `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *LibraryHandler) MemeFolders(c echo.Context) error {
	var req MemeFoldersRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	folders, err := h.libraryService.MemeFolders(c.Request().Context(), rbac.GetIdentity(c), req.ID, limitOr(req.Limit, 20))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, folders)
}

type SharedNodeRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Share string `query:"share" validate:"omitempty,uuid"` // A private link to a folder at or above the node
}

func (h *LibraryHandler) PublicFolder(c echo.Context) error {
	var req SharedNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	view, err := h.libraryService.PublicFolder(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, view)
}

type FolderEntriesRequest struct {
	ID     string `param:"id" validate:"required,uuid"`
	Share  string `query:"share" validate:"omitempty,uuid"`
	Cursor string `query:"cursor" validate:"omitempty,uuid"`
	Limit  int    `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *LibraryHandler) FolderEntries(c echo.Context) error {
	var req FolderEntriesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	feed, err := h.libraryService.FolderEntries(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share, req.Cursor, limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}

func (h *LibraryHandler) Entry(c echo.Context) error {
	var req SharedNodeRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	entry, err := h.libraryService.Entry(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, entry)
}

type ProfileRequest struct {
	Username string `param:"username" validate:"required,max=50"`
}

func (h *LibraryHandler) Profile(c echo.Context) error {
	var req ProfileRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	profile, err := h.libraryService.Profile(c.Request().Context(), rbac.GetIdentity(c), req.Username)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, profile)
}

type ProfileMemesRequest struct {
	Username string `param:"username" validate:"required,max=50"`
	Cursor   string `query:"cursor" validate:"omitempty,uuid"`
	Limit    int    `query:"limit" validate:"omitempty,min=1,max=100"`
}

func (h *LibraryHandler) ProfileMemes(c echo.Context) error {
	var req ProfileMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	feed, err := h.libraryService.ProfileMemes(c.Request().Context(), rbac.GetIdentity(c), req.Username, req.Cursor, limitOr(req.Limit, 40))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, feed)
}
