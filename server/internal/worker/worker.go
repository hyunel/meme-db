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
	minBackoff             = 500 * time.Millisecond
	maxBackoff             = 5 * time.Second
	staleTaskCheckInterval = 10 * time.Minute
	staleTaskThreshold     = 10 * time.Minute
	taskTimeout            = staleTaskThreshold - 30*time.Second
)

var ErrRescheduled = errors.New("task rescheduled")

type Worker struct {
	cfg      *config.Config
	repo     *repository.Provider
	handlers map[string]TaskHandler
}

func NewWorker(
	cfg *config.Config,
	repo *repository.Provider,
) (*Worker, error) {
	w := &Worker{
		cfg:      cfg,
		repo:     repo,
		handlers: make(map[string]TaskHandler),
	}

	return w, nil
}

func (w *Worker) RegisterHandler(jobType string, handler TaskHandler) {
	w.handlers[jobType] = handler
}

func (w *Worker) Start(ctx context.Context) {
	// Start single queue loop
	go func() {
		backoff := minBackoff

		for {
			select {
			case <-ctx.Done():
				return
			default:
				processed := w.processNext(ctx)
				if processed {
					backoff = minBackoff // Reset backoff on success
				} else {
					// No task, sleep with backoff
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

	// Start stale task recovery ticker
	go func() {
		ticker := time.NewTicker(staleTaskCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := w.repo.Task.ResetStaleTasks(ctx, staleTaskThreshold); err != nil {
					slog.Error("Failed to reset stale tasks", "error", err)
				}
			}
		}
	}()

	slog.Info("Worker started")
	<-ctx.Done()
	slog.Info("Worker stopping...")
}

func (w *Worker) processNext(ctx context.Context) bool {
	task, err := w.repo.Task.GetNextPendingTask(ctx)
	if err != nil {
		slog.Error("Error getting next task", "error", err)
		return false
	}
	if task == nil {
		return false
	}

	slog.Info("Processing task", "id", task.ID, "type", task.JobType)

	handler, ok := w.handlers[task.JobType]
	var procErr error
	if !ok {
		procErr = fmt.Errorf("no handler for job type: %s", task.JobType)
	} else {
		// We could wrap this in a panic handler to ensure worker doesn't crash
		func() {
			defer func() {
				if r := recover(); r != nil {
					procErr = fmt.Errorf("panic in handler: %v", r)
				}
			}()

			handlerCtx, cancel := context.WithTimeout(ctx, taskTimeout)
			defer cancel()

			procErr = handler.Handle(handlerCtx, task)
		}()
	}

	if errors.Is(procErr, ErrRescheduled) {
		slog.Info("Task rescheduled by handler", "id", task.ID)
		// Reschedule without history (just update run_at/payload/context)
		// ResetTask resets status to pending and updates run_at/context
		if err := w.repo.Task.ResetTask(ctx, task.ID, time.Now(), task.Context); err != nil {
			slog.Error("Failed to reschedule task from handler", "id", task.ID, "error", err)
		}
		return true
	}

	// Handle Cron rescheduling regardless of success/failure
	if task.Cron != nil && *task.Cron != "" {
		next, err := gronx.NextTick(*task.Cron, false)
		if err != nil {
			slog.Error("Invalid cron expression", "id", task.ID, "cron", *task.Cron, "error", err)
		} else {
			// Prepare history record logic
			now := time.Now()
			historyStatus := model.TaskStatusCompleted
			var errMsg *string
			if procErr != nil {
				historyStatus = model.TaskStatusFailed
				msg := procErr.Error()
				errMsg = &msg
			}

			// Atomic Reschedule: Create History -> Reset Task
			err := w.repo.Transaction(ctx, func(r *repository.Repositories) error {
				if err := r.Task.CreateHistoryFromTask(ctx, task.ID, historyStatus, &now, errMsg); err != nil {
					return err
				}
				return r.Task.ResetTask(ctx, task.ID, next, task.Context)
			})

			if err != nil {
				slog.Error("Failed to reschedule task with history", "id", task.ID, "error", err)
			} else {
				slog.Info("Task rescheduled with history", "id", task.ID, "next_run", next)

				// If there was an error in execution, we log it but still rescheduled.
				if procErr != nil {
					slog.Error("Task execution failed before rescheduling", "id", task.ID, "error", procErr)
				}
				return true
			}
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

	if err := w.repo.Task.UpdateTaskStatus(ctx, task.ID, status, errMsg); err != nil {
		slog.Error("Failed to update task status", "error", err)
	}

	return true
}
