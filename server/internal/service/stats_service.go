package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/repository"
)

type HealthReporter interface {
	Health() (ok bool, detail string)
}

type StatsService struct {
	repo        *repository.Provider
	inference   HealthReporter
	storagePath string
}

func NewStatsService(repo *repository.Provider, inference HealthReporter, storagePath string) *StatsService {
	return &StatsService{repo: repo, inference: inference, storagePath: storagePath}
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
	db := model.ServiceStatus{Name: "数据库", OK: true}
	if err := s.repo.Ping(ctx); err != nil {
		db.OK, db.Detail = false, err.Error()
	} else {
		db.Detail = fmt.Sprintf("响应 %dms", time.Since(start).Milliseconds())
	}

	inference := model.ServiceStatus{Name: "推理服务"}
	ok, state := s.inference.Health()
	inference.OK, inference.Detail = ok, "连接状态 "+state

	storage := model.ServiceStatus{Name: "文件存储", OK: true, Detail: s.storagePath}
	if info, err := os.Stat(s.storagePath); err != nil || !info.IsDir() {
		storage.OK, storage.Detail = false, "存储目录不可用"
	}
	return []model.ServiceStatus{db, inference, storage}
}
