package service

import (
	"context"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

type EventService struct{ repo *repository.Provider }

func NewEventService(repo *repository.Provider) *EventService { return &EventService{repo: repo} }

func (s *EventService) Record(ctx context.Context, viewer *rbac.Identity, events []model.Event) error {
	var uses, views []model.Event
	var sources []string
	admin := viewer.IsAdmin()
	for _, e := range events {
		if !admin {
			e.At = time.Time{}
		}
		switch e.Kind {
		case model.EventUse:
			if !admin || e.Source == model.SourceVLM {
				return apperror.Forbidden("forbidden", "access denied")
			}
			uses = append(uses, e)
			sources = append(sources, e.Source)
		case model.EventView:
			views = append(views, e)
		default:
			return apperror.BadRequest("invalid_event", "invalid event")
		}
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		if err := r.Source.Ensure(ctx, sources...); err != nil {
			return err
		}
		if err := r.Event.InsertUses(ctx, uses); err != nil {
			return err
		}
		return r.Event.Insert(ctx, viewer.UserID, admin, views)
	})
}

func (s *EventService) RecordSave(ctx context.Context, r *repository.Repos, viewerID string, event model.Event) error {
	event.Kind = model.EventSave
	return r.Event.Insert(ctx, viewerID, false, []model.Event{event})
}
