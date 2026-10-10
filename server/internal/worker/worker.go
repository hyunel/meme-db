package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/adhocore/gronx"
	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
)

// Store persists task state. Transitions out of 'running' are guarded by the attempts
// value returned from Claim, so they are no-ops once the lease was taken over.
type Store interface {
	Claim(ctx context.Context, limit int, lease time.Duration) ([]*model.Task, error)
	Finish(ctx context.Context, id string, attempts int, status string, errorMessage *string) error
	Retry(ctx context.Context, id string, attempts int, runAt time.Time, errorMessage string) error
	Release(ctx context.Context, id string, attempts int) error
	Reschedule(ctx context.Context, task *model.Task, status string, errorMessage *string, next time.Time) error
	Requeue(ctx context.Context, ids []string) ([]*model.Task, error)
	Cancel(ctx context.Context, id, reason string) (*model.Task, error)
	RunNow(ctx context.Context, id string) (bool, error)
}

var (
	errLeaseExhausted = errors.New("lease expired too many times")
	errCancelled      = errors.New("已被管理员取消")
)

// Worker runs queued tasks, keeping up to cfg.Concurrency in flight and claiming
// more as slots free up.
type Worker struct {
	cfg      config.WorkerConfig
	store    Store
	handlers map[string]TaskHandler
	wake     chan struct{}
}

func NewWorker(cfg config.WorkerConfig, store Store) *Worker {
	return &Worker{
		cfg:      cfg,
		store:    store,
		handlers: make(map[string]TaskHandler),
		wake:     make(chan struct{}, 1),
	}
}

// RegisterHandler must be called before Run.
func (w *Worker) RegisterHandler(jobType string, handler TaskHandler) {
	w.handlers[jobType] = handler
}

// Notify wakes the worker without blocking; call it after enqueued tasks are committed.
func (w *Worker) Notify() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// Requeue gives failed tasks a fresh attempt budget and returns how many were requeued.
func (w *Worker) Requeue(ctx context.Context, ids []string) (int, error) {
	tasks, err := w.store.Requeue(ctx, ids)
	if err != nil {
		return 0, err
	}
	for _, task := range tasks {
		if h, ok := w.handlers[task.JobType].(RequeueHandler); ok {
			if err := h.OnRequeue(ctx, task); err != nil {
				return 0, fmt.Errorf("requeue hook for %s: %w", task.ID, err)
			}
		}
	}
	w.Notify()
	return len(tasks), nil
}

// Cancel fails a pending task without running it; it reports false if the task is not pending.
func (w *Worker) Cancel(ctx context.Context, id string) (bool, error) {
	task, err := w.store.Cancel(ctx, id, errCancelled.Error())
	if err != nil || task == nil {
		return false, err
	}
	if h, ok := w.handlers[task.JobType].(FailureHandler); ok {
		if err := h.OnFailure(ctx, task, errCancelled); err != nil {
			return false, fmt.Errorf("failure hook: %w", err)
		}
	}
	return true, nil
}

// RunNow makes a pending task due immediately; it reports false if the task is not pending.
func (w *Worker) RunNow(ctx context.Context, id string) (bool, error) {
	ok, err := w.store.RunNow(ctx, id)
	if ok {
		w.Notify()
	}
	return ok, err
}

// Run blocks until ctx is cancelled and every in-flight task has been settled.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	defer wg.Wait()

	slots := make(chan struct{}, w.cfg.Concurrency)
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	slog.Info("Worker started", "concurrency", w.cfg.Concurrency)
	defer slog.Info("Worker stopped")

	for {
		// Claim only once at least one slot is free.
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return
		}

		// The lease outlives JobTimeout, so a live task is never reclaimed.
		tasks, err := w.store.Claim(ctx, cap(slots)-len(slots)+1, 2*w.cfg.JobTimeout)
		if err != nil && ctx.Err() == nil {
			slog.Error("Failed to claim tasks", "error", err)
		}
		if len(tasks) == 0 {
			<-slots
			select {
			case <-w.wake:
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
			continue
		}

		for i, task := range tasks {
			if i > 0 {
				slots <- struct{}{} // Never blocks: claimed at most the free slots, and only this loop acquires
			}
			wg.Add(1)
			go func() {
				defer func() {
					<-slots
					wg.Done()
				}()
				w.process(ctx, task)
			}()
		}
	}
}

func (w *Worker) process(ctx context.Context, task *model.Task) {
	handler, ok := w.handlers[task.JobType]

	var err error
	switch {
	case !ok:
		err = Permanent(fmt.Errorf("no handler for job type: %s", task.JobType))
	case task.Attempts > w.cfg.MaxAttempts: // Only when leases keep expiring (crash or hang)
		err = errLeaseExhausted
	default:
		err = w.handle(ctx, handler, task)
	}

	if err := w.settle(ctx, handler, task, err); err != nil {
		// The lease expiring is the fallback: the task will be claimed again.
		slog.Error("Failed to settle task", "id", task.ID, "error", err)
	}
}

func (w *Worker) handle(ctx context.Context, handler TaskHandler, task *model.Task) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("panic in handler: %v", rec)
		}
	}()

	ctx, cancel := context.WithTimeout(ctx, w.cfg.JobTimeout)
	defer cancel()
	return handler.Handle(ctx, task)
}

// settle records the outcome of an attempt. It must persist even when ctx is cancelled by shutdown.
func (w *Worker) settle(ctx context.Context, handler TaskHandler, task *model.Task, cause error) error {
	dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	log := slog.With("id", task.ID, "type", task.JobType, "attempt", task.Attempts)
	switch {
	case cause == nil:
		log.Info("Task completed")
		return w.finish(dbCtx, task, model.TaskStatusCompleted, nil)
	case ctx.Err() != nil:
		log.Info("Task interrupted by shutdown, releasing", "error", cause)
		return w.store.Release(dbCtx, task.ID, task.Attempts)
	case !isPermanent(cause) && task.Attempts < w.cfg.MaxAttempts:
		runAt := time.Now().Add(retryBackoff(task.Attempts))
		log.Warn("Task failed, will retry", "retry_at", runAt, "error", cause)
		return w.store.Retry(dbCtx, task.ID, task.Attempts, runAt, cause.Error())
	}

	log.Error("Task failed", "error", cause)
	if h, ok := handler.(FailureHandler); ok {
		if err := h.OnFailure(dbCtx, task, cause); err != nil {
			return fmt.Errorf("failure hook: %w", err)
		}
	}
	return w.finish(dbCtx, task, model.TaskStatusFailed, cause)
}

// finish ends a task with a terminal status. Recurring (cron) tasks are instead
// recorded in history and rescheduled for their next tick.
func (w *Worker) finish(ctx context.Context, task *model.Task, status string, cause error) error {
	var errMsg *string
	if cause != nil {
		msg := cause.Error()
		errMsg = &msg
	}

	if task.Cron != nil && *task.Cron != "" {
		next, err := gronx.NextTick(*task.Cron, false)
		if err == nil {
			return w.store.Reschedule(ctx, task, status, errMsg, next)
		}
		slog.Error("Invalid cron expression", "id", task.ID, "cron", *task.Cron, "error", err)
	}
	return w.store.Finish(ctx, task.ID, task.Attempts, status, errMsg)
}

// retryBackoff grows 1m, 4m, 16m, 64m with up to 25% jitter, so a recovered
// dependency is not hit by every failed task at once.
func retryBackoff(attempt int) time.Duration {
	d := time.Minute << (2 * min(attempt-1, 3))
	return d + rand.N(d/4)
}
