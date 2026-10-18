package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"slices"
	"sync"
	"time"

	"github.com/adhocore/gronx"
	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
)

// Store transitions out of 'running' are fenced by the attempts value from Claim, so they are no-ops once the lease is taken over.
type Store interface {
	Claim(ctx context.Context, limit int) ([]*model.Task, error)
	Finish(ctx context.Context, id string, attempts int, status string, errorMessage *string) error
	Retry(ctx context.Context, id string, attempts int, runAt time.Time, errorMessage string) error
	Release(ctx context.Context, id string, attempts int) error
	Requeue(ctx context.Context, ids []string) ([]*model.Task, error)
	Cancel(ctx context.Context, id, reason string) (*model.Task, error)
	CancelBatch(ctx context.Context, batchID, reason string) ([]*model.Task, error)
	RunNow(ctx context.Context, id string) (bool, error)
	EnqueueScheduled(ctx context.Context, name, jobType string, payload []byte) (bool, error)
}

var (
	errLeaseExhausted = errors.New("lease expired too many times")
	errCancelled      = errors.New("cancelled by an admin")
)

type Worker struct {
	cfg       config.WorkerConfig
	store     Store
	handlers  map[string]TaskHandler
	schedules []config.TaskConfig
	wake      chan struct{}
}

func NewWorker(cfg config.WorkerConfig, store Store) *Worker {
	return &Worker{
		cfg:      cfg,
		store:    store,
		handlers: make(map[string]TaskHandler),
		wake:     make(chan struct{}, 1),
	}
}

func (w *Worker) RegisterHandler(jobType string, handler TaskHandler) {
	w.handlers[jobType] = handler
}

// Schedule sets the configured tasks, each made a task of on its cron, or by hand with RunSchedule.
func (w *Worker) Schedule(tasks []config.TaskConfig) error {
	for _, t := range tasks {
		if _, ok := w.handlers[t.Type]; !ok {
			return fmt.Errorf("task %s: no job type %s", t.Name, t.Type)
		}
	}
	w.schedules = tasks
	return nil
}

func (w *Worker) Schedules() []config.TaskConfig {
	return w.schedules
}

// RunSchedule makes a task of the configured one now; false when its last is unfinished.
func (w *Worker) RunSchedule(ctx context.Context, name string) (bool, error) {
	i := slices.IndexFunc(w.schedules, func(t config.TaskConfig) bool { return t.Name == name })
	if i < 0 {
		return false, fmt.Errorf("no configured task named %s", name)
	}
	return w.start(ctx, w.schedules[i])
}

// start makes a task of a configured one, unless its last is unfinished.
func (w *Worker) start(ctx context.Context, t config.TaskConfig) (bool, error) {
	params := t.Params
	if params == nil {
		params = map[string]any{}
	}
	payload, err := json.Marshal(params)
	if err != nil {
		return false, fmt.Errorf("invalid params for %s: %w", t.Name, err)
	}
	ok, err := w.store.EnqueueScheduled(ctx, t.Name, t.Type, payload)
	if ok {
		w.Notify()
	}
	return ok, err
}

// NextRun is when a cron next fires; nil without one.
func NextRun(cron string) *time.Time {
	if cron == "" {
		return nil
	}
	next, err := gronx.NextTick(cron, false)
	if err != nil {
		return nil // Checked as the config loads
	}
	return &next
}

// runSchedules makes a task of each configured one as its cron fires. Ticks while its last is unfinished are skipped,
// as are those missed while the server was down.
func (w *Worker) runSchedules(ctx context.Context) {
	next := make([]*time.Time, len(w.schedules))
	for i, t := range w.schedules {
		next[i] = NextRun(t.Cron)
	}
	for {
		var due *time.Time
		for _, n := range next {
			if n != nil && (due == nil || n.Before(*due)) {
				due = n
			}
		}
		if due == nil {
			return
		}
		select {
		case <-time.After(time.Until(*due)):
		case <-ctx.Done():
			return
		}

		for i, t := range w.schedules {
			if next[i] == nil || next[i].After(time.Now()) {
				continue
			}
			ok, err := w.start(ctx, t)
			switch {
			case err != nil:
				if ctx.Err() == nil {
					slog.Error("Failed to start a configured task", "name", t.Name, "error", err)
				}
			case !ok:
				slog.Info("Skipped a configured task, as its last is unfinished", "name", t.Name)
			}
			next[i] = NextRun(t.Cron)
		}
	}
}

func (w *Worker) Notify() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

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

func (w *Worker) Cancel(ctx context.Context, id string) (bool, error) {
	task, err := w.store.Cancel(ctx, id, errCancelled.Error())
	if err != nil || task == nil {
		return false, err
	}
	return true, w.cancelled(ctx, task)
}

// CancelBatch cancels the batch's tasks still waiting to run.
func (w *Worker) CancelBatch(ctx context.Context, batchID string) (int, error) {
	tasks, err := w.store.CancelBatch(ctx, batchID, errCancelled.Error())
	if err != nil {
		return 0, err
	}
	for _, task := range tasks {
		if err := w.cancelled(ctx, task); err != nil {
			return 0, err
		}
	}
	return len(tasks), nil
}

func (w *Worker) cancelled(ctx context.Context, task *model.Task) error {
	if h, ok := w.handlers[task.JobType].(FailureHandler); ok {
		if err := h.OnFailure(ctx, task, errCancelled); err != nil {
			return fmt.Errorf("failure hook for %s: %w", task.ID, err)
		}
	}
	return nil
}

func (w *Worker) RunNow(ctx context.Context, id string) (bool, error) {
	ok, err := w.store.RunNow(ctx, id)
	if ok {
		w.Notify()
	}
	return ok, err
}

func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	defer wg.Wait()

	slots := make(chan struct{}, w.cfg.Concurrency)
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	slog.Info("Worker started", "concurrency", w.cfg.Concurrency)
	defer slog.Info("Worker stopped")

	wg.Add(1)
	go func() {
		defer wg.Done()
		w.runSchedules(ctx)
	}()

	for {
		// Claim only once at least one slot is free.
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return
		}

		tasks, err := w.store.Claim(ctx, cap(slots)-len(slots)+1)
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
	case task.Attempts > task.MaxAttempts: // Only when leases keep expiring (crash or hang)
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

	ctx, cancel := context.WithTimeout(ctx, time.Duration(task.TimeoutSecs)*time.Second)
	defer cancel()
	return handler.Handle(ctx, task)
}

func (w *Worker) settle(ctx context.Context, handler TaskHandler, task *model.Task, cause error) error {
	dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second) // Outcomes persist through shutdown
	defer cancel()

	log := slog.With("id", task.ID, "type", task.JobType, "attempt", task.Attempts)
	switch {
	case cause == nil:
		log.Info("Task completed")
		return w.finish(dbCtx, task, model.TaskStatusCompleted, nil)
	case ctx.Err() != nil:
		log.Info("Task interrupted by shutdown, releasing", "error", cause)
		return w.store.Release(dbCtx, task.ID, task.Attempts)
	case !errors.As(cause, new(*permanentError)) && task.Attempts < task.MaxAttempts:
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

func (w *Worker) finish(ctx context.Context, task *model.Task, status string, cause error) error {
	var errMsg *string
	if cause != nil {
		msg := cause.Error()
		errMsg = &msg
	}
	return w.store.Finish(ctx, task.ID, task.Attempts, status, errMsg)
}

// retryBackoff grows 1m, 4m, 16m, 64m with up to 25% jitter, so a recovered dependency is not hit all at once.
func retryBackoff(attempt int) time.Duration {
	d := time.Minute << (2 * min(attempt-1, 3))
	return d + rand.N(d/4)
}
