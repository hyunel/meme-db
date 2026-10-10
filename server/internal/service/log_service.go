package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/logger"
	"github.com/hyunel/MemeDB/internal/repository"
)

type LogFilter = repository.LogFilter

const logBatchSize = 500

// LogService stores service logs for the admin console and serves them back.
type LogService struct {
	repo      *repository.Provider
	retention time.Duration
}

func NewLogService(repo *repository.Provider, retention time.Duration) *LogService {
	return &LogService{repo: repo, retention: retention}
}

// Run stores logged entries in batches and hourly deletes those older than the
// retention. Once ctx is done it stores what is still queued and returns.
func (s *LogService) Run(ctx context.Context, entries <-chan logger.Entry) {
	flushTicker := time.NewTicker(time.Second)
	defer flushTicker.Stop()
	purgeTicker := time.NewTicker(time.Hour)
	defer purgeTicker.Stop()

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

	s.purge(ctx)
	for {
		select {
		case e := <-entries:
			add(e)
			if len(batch) >= logBatchSize {
				flush()
			}
		case <-flushTicker.C:
			flush()
		case <-purgeTicker.C:
			s.purge(ctx)
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

func (s *LogService) purge(ctx context.Context) {
	if err := s.repo.Log.DeleteBefore(ctx, time.Now().Add(-s.retention)); err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "failed to delete expired logs: %v\n", err)
	}
}

// List returns stored entries matching f; see repository.LogRepository.List.
func (s *LogService) List(ctx context.Context, f LogFilter, afterID, beforeID int64, limit int) ([]*model.LogEntry, error) {
	return s.repo.Log.List(ctx, f, afterID, beforeID, limit)
}
