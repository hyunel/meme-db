package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

// ShareHandler serves the private links of /memes/:id/share and /folders/:id/share alike, as the id tells them apart.
type ShareHandler struct {
	shareService *service.ShareService
}

func NewShareHandler(shareService *service.ShareService) *ShareHandler {
	return &ShareHandler{shareService: shareService}
}

type ShareTargetRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

// Get returns the viewer's private link to the meme or folder, or null.
func (h *ShareHandler) Get(c echo.Context) error {
	var req ShareTargetRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	link, err := h.shareService.Get(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, link)
}

func (h *ShareHandler) CreateMemeLink(c echo.Context) error {
	var req ShareTargetRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	link, err := h.shareService.CreateMemeLink(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, link)
}

func (h *ShareHandler) CreateFolderLink(c echo.Context) error {
	var req ShareTargetRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	link, err := h.shareService.CreateFolderLink(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, link)
}

func (h *ShareHandler) Delete(c echo.Context) error {
	var req ShareTargetRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.shareService.Delete(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type ViewShareLinkRequest struct {
	ID    string `param:"id" validate:"required,uuid"`
	Share string `json:"share" validate:"required,uuid"`
}

// View counts a page load of what a private link opens; the page reports it once, unlike its refetches.
func (h *ShareHandler) View(c echo.Context) error {
	var req ViewShareLinkRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.shareService.View(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Share); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *ShareHandler) List(c echo.Context) error {
	links, err := h.shareService.List(c.Request().Context(), rbac.GetIdentity(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, links)
}
