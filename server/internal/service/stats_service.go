package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/storage"
	"github.com/hyunel/MemeDB/internal/repository"
)

type InferenceMonitor interface {
	Metrics(ctx context.Context, span, step time.Duration) ([]byte, error)
}

type StatsService struct {
	repo      *repository.Provider
	inference InferenceMonitor
	files     storage.Storage
}

func NewStatsService(repo *repository.Provider, inference InferenceMonitor, files storage.Storage) *StatsService {
	return &StatsService{repo: repo, inference: inference, files: files}
}

const maxTrendDays = 366

func (s *StatsService) Overview(ctx context.Context, from, to time.Time, tz string) (*model.Overview, error) {
	if to.Sub(from) > maxTrendDays*24*time.Hour {
		from = to.Add(-maxTrendDays * 24 * time.Hour)
	}
	o, err := s.repo.Stats.Counts(ctx, from, to)
	if err != nil {
		return nil, err
	}
	if o.Tasks, err = s.repo.Task.Summary(ctx, repository.TimeRange{From: from, To: to}); err != nil {
		return nil, err
	}
	if o.Trend, err = s.repo.Stats.Trend(ctx, from, to, tz); err != nil {
		return nil, err
	}
	o.Services = s.services(ctx)
	return o, nil
}

func (s *StatsService) services(ctx context.Context) []model.ServiceStatus {
	start := time.Now()
	db := model.ServiceStatus{Name: "database", OK: true}
	if err := s.repo.Ping(ctx); err != nil {
		db.OK, db.Detail = false, err.Error()
	} else {
		db.Detail = fmt.Sprintf("%dms", time.Since(start).Milliseconds()) // Round trip
	}

	files := model.ServiceStatus{Name: "storage", OK: true, Detail: s.files.String()}
	if err := s.files.Ping(ctx); err != nil {
		files.OK, files.Detail = false, err.Error()
	}
	return []model.ServiceStatus{db, files}
}

// Spans of the inference dashboard's time ranges, and the steps they are bucketed in
var inferenceRanges = map[string][2]time.Duration{
	"15m": {15 * time.Minute, 15 * time.Second},
	"1h":  {time.Hour, 30 * time.Second},
	"6h":  {6 * time.Hour, 3 * time.Minute},
	"24h": {24 * time.Hour, 12 * time.Minute},
}

func (s *StatsService) Inference(ctx context.Context, rng string) (json.RawMessage, error) {
	r := inferenceRanges[rng]
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	data, err := s.inference.Metrics(ctx, r[0], r[1])
	if err != nil {
		return nil, apperror.New(http.StatusServiceUnavailable, "inference_unavailable", "the inference service is not responding", err)
	}
	return data, nil
}
