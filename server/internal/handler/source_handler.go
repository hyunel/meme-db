package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type SourceHandler struct {
	sourceService *service.SourceService
}

func NewSourceHandler(sourceService *service.SourceService) *SourceHandler {
	return &SourceHandler{sourceService: sourceService}
}

func (h *SourceHandler) List(c echo.Context) error {
	sources, err := h.sourceService.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, sources)
}

// SourceRequest names a source as it chooses, such as the platform it brings memes from.
type SourceRequest struct {
	Source string `param:"source" validate:"required,max=50,slug"`
}

type SourceMeme struct {
	Tags *[]string `json:"tags"`
}

type UpdateSourceMemesRequest struct {
	SourceRequest
	Memes map[string]SourceMeme `json:"memes" validate:"required,min=1,max=1000,dive,keys,uuid,endkeys"` // By meme ID
}

func (h *SourceHandler) UpdateMemes(c echo.Context) error {
	var req UpdateSourceMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	tags := make(map[string][]string, len(req.Memes))
	for id, meme := range req.Memes {
		if meme.Tags == nil {
			continue
		}
		tags[id] = make([]string, len(*meme.Tags))
		for i, tag := range *meme.Tags {
			name, err := tagName(tag)
			if err != nil {
				return err
			}
			tags[id][i] = name
		}
	}
	if err := h.sourceService.Update(c.Request().Context(), req.Source, tags); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *SourceHandler) Delete(c echo.Context) error {
	var req SourceRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.sourceService.Delete(c.Request().Context(), req.Source); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
