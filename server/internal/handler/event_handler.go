package handler

import (
	"net/http"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type EventHandler struct{ events *service.EventService }

func NewEventHandler(events *service.EventService) *EventHandler {
	return &EventHandler{events: events}
}

type EventRequest struct {
	Kind     string    `json:"kind" validate:"required,oneof=use view"`
	Source   string    `json:"source" validate:"required_if=Kind use,excluded_if=Kind view,omitempty,max=50,slug"`
	At       time.Time `json:"at" validate:"required_if=Kind use"`
	MemeID   string    `json:"meme_id" validate:"required_without=FolderID,omitempty,uuid,excluded_with=FolderID"`
	FolderID string    `json:"folder_id" validate:"required_without=MemeID,omitempty,uuid,excluded_with=MemeID"`
	Share    string    `json:"share" validate:"excluded_if=Kind use,omitempty,uuid"`
}

type RecordEventsRequest struct {
	Events []EventRequest `json:"events" validate:"required,min=1,max=1000,dive"`
}

func (h *EventHandler) Record(c echo.Context) error {
	var req RecordEventsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	events := make([]model.Event, len(req.Events))
	for i, e := range req.Events {
		events[i] = model.Event{Kind: e.Kind, Source: e.Source, At: e.At, MemeID: e.MemeID, FolderID: e.FolderID, Share: e.Share}
	}
	if err := h.events.Record(c.Request().Context(), rbac.GetIdentity(c), events); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
