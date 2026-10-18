package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/logger"
	"github.com/hyunel/MemeDB/internal/repository"
)

type LogFilter = repository.LogFilter

const logBatchSize = 500

type LogService struct {
	repo *repository.Provider
}

func NewLogService(repo *repository.Provider) *LogService {
	return &LogService{repo: repo}
}

func (s *LogService) Run(ctx context.Context, entries <-chan logger.Entry) {
	flushTicker := time.NewTicker(time.Second)
	defer flushTicker.Stop()

	var batch []*model.LogEntry
	add := func(e logger.Entry) {
		batch = append(batch, &model.LogEntry{Time: e.Time, Level: e.Level, Message: e.Message, Attrs: e.Attrs})
	}
	flush := func() {
		if len(batch) == 0 {
			return
		}
		// Store even while shutting down; failures go to stderr, as logging them would loop.
		dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := s.repo.Log.Insert(dbCtx, batch); err != nil {
			fmt.Fprintf(os.Stderr, "failed to store %d log entries: %v\n", len(batch), err)
		}
		batch = batch[:0]
	}

	for {
		select {
		case e := <-entries:
			add(e)
			if len(batch) >= logBatchSize {
				flush()
			}
		case <-flushTicker.C:
			flush()
		case <-ctx.Done():
			for {
				select {
				case e := <-entries:
					add(e)
				default:
					flush()
					return
				}
			}
		}
	}
}

func (s *LogService) Purge(ctx context.Context, task *model.Task) error {
	before, err := purgeCutoff(task)
	if err != nil {
		return err
	}
	n, err := s.repo.Log.DeleteBefore(ctx, before)
	if err == nil {
		slog.Info("Purged logs", "count", n, "before", before)
	}
	return err
}

func (s *LogService) List(ctx context.Context, f LogFilter, afterID, beforeID int64, limit int) ([]*model.LogEntry, error) {
	return s.repo.Log.List(ctx, f, afterID, beforeID, limit)
}
