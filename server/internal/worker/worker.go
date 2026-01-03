package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/adhocore/gronx"
	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/repository"
)

const (
	minBackoff = 500 * time.Millisecond
	maxBackoff = 5 * time.Second
)

var ErrRescheduled = errors.New("task rescheduled")

type Worker struct {
	cfg      *config.Config
	repo     *repository.Provider
	handlers map[string]TaskHandler
}

func NewWorker(cfg *config.Config, repo *repository.Provider) (*Worker, error) {
	return &Worker{
		cfg:      cfg,
		repo:     repo,
		handlers: make(map[string]TaskHandler),
	}, nil
}

func (w *Worker) RegisterHandler(jobType string, handler TaskHandler) {
	w.handlers[jobType] = handler
}

func (w *Worker) Start(ctx context.Context) {
	go func() {
		backoff := minBackoff

		for {
			select {
			case <-ctx.Done():
				return
			default:
				processed := w.processNext(ctx)
				if processed {
					backoff = minBackoff
				} else {
					select {
					case <-ctx.Done():
						return
					case <-time.After(backoff):
						if backoff < maxBackoff {
							backoff *= 2
						}
					}
				}
			}
		}
	}()

	slog.Info("Worker started")
	<-ctx.Done()
	slog.Info("Worker stopping...")
}

func (w *Worker) processNext(ctx context.Context) bool {
	var processed bool

	err := w.repo.TxNoRLS(ctx, func(r *repository.Repos) error {
		task, err := r.Task.GetNextPending(ctx)
		if err != nil {
			return err
		}

		if task == nil {
			return nil
		}

		processed = true
		slog.Info("Processing task", "id", task.ID, "type", task.JobType)

		handler, ok := w.handlers[task.JobType]
		var procErr error
		if !ok {
			procErr = fmt.Errorf("no handler for job type: %s", task.JobType)
		} else {
			func() {
				defer func() {
					if rec := recover(); rec != nil {
						procErr = fmt.Errorf("panic in handler: %v", rec)
					}
				}()

				handlerCtx, cancel := context.WithTimeout(ctx, time.Duration(model.TaskProcessingTimeout)*time.Minute)
				defer cancel()

				procErr = handler.Handle(handlerCtx, task)
			}()
		}

		if errors.Is(procErr, ErrRescheduled) {
			slog.Info("Task rescheduled by handler", "id", task.ID)
			return r.Task.Reset(ctx, task.ID, time.Now(), task.Payload)
		}

		// Handle Cron rescheduling regardless of success/failure
		if task.Cron != nil && *task.Cron != "" {
			next, err := gronx.NextTick(*task.Cron, false)
			if err != nil {
				slog.Error("Invalid cron expression", "id", task.ID, "cron", *task.Cron, "error", err)
			} else {
				now := time.Now()
				historyStatus := model.TaskStatusCompleted
				var errMsg *string
				if procErr != nil {
					historyStatus = model.TaskStatusFailed
					msg := procErr.Error()
					errMsg = &msg
				}

				if err := r.Task.CreateHistory(ctx, task.ID, historyStatus, &now, errMsg); err != nil {
					return err
				}
				if err := r.Task.Reset(ctx, task.ID, next, task.Payload); err != nil {
					return err
				}

				if procErr != nil {
					slog.Error("Task execution failed before rescheduling", "id", task.ID, "error", procErr)
				} else {
					slog.Info("Task rescheduled with history", "id", task.ID, "next_run", next)
				}
				return nil
			}
		}

		status := model.TaskStatusCompleted
		var errMsg *string
		if procErr != nil {
			status = model.TaskStatusFailed
			msg := procErr.Error()
			errMsg = &msg
			slog.Error("Task failed", "id", task.ID, "error", procErr)
		} else {
			slog.Info("Task completed", "id", task.ID)
		}

		return r.Task.UpdateStatus(ctx, task.ID, status, errMsg)
	})

	if err != nil {
		slog.Error("Error in task processing transaction", "error", err)
		return false
	}

	return processed
}
