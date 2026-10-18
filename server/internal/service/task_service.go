package service

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/hyunel/MemeDB/internal/worker"
)

type TaskQueue interface {
	Requeue(ctx context.Context, ids []string) (int, error)
	Cancel(ctx context.Context, id string) (bool, error)
	CancelBatch(ctx context.Context, batchID string) (int, error)
	RunNow(ctx context.Context, id string) (bool, error)
	Schedules() []config.TaskConfig
	RunSchedule(ctx context.Context, name string) (bool, error)
}

type TaskService struct {
	repo  *repository.Provider
	queue TaskQueue
}

func NewTaskService(repo *repository.Provider, queue TaskQueue) *TaskService {
	return &TaskService{repo: repo, queue: queue}
}

func (s *TaskService) List(ctx context.Context, f repository.TaskFilter, page repository.Page) (*model.Page[*model.Task], error) {
	tasks, total, err := s.repo.Task.List(ctx, f, page)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.Task]{Items: tasks, Total: total}, nil
}

func (s *TaskService) Summary(ctx context.Context, finished repository.TimeRange) ([]*model.TaskTypeCounts, error) {
	return s.repo.Task.Summary(ctx, finished)
}

func (s *TaskService) Get(ctx context.Context, id string) (*model.Task, error) {
	task, err := s.repo.Task.Get(ctx, id)
	if err == nil && task == nil {
		err = apperror.NotFound("task_not_found", "task not found")
	}
	return task, err
}

// Schedule is a configured task, as the admin console lists them.
type Schedule struct {
	config.TaskConfig
	NextRun *time.Time  `json:"next_run"` // Nil for one run only by hand
	Last    *model.Task `json:"last"`     // The latest task it made
}

func (s *TaskService) Schedules(ctx context.Context) ([]*Schedule, error) {
	configured := s.queue.Schedules()
	names := make([]string, len(configured))
	for i, t := range configured {
		names[i] = t.Name
	}
	latest, err := s.repo.Task.LatestScheduled(ctx, names)
	if err != nil {
		return nil, err
	}
	schedules := make([]*Schedule, len(configured))
	for i, t := range configured {
		schedules[i] = &Schedule{TaskConfig: t, NextRun: worker.NextRun(t.Cron)}
		if j := slices.IndexFunc(latest, func(l *model.Task) bool { return *l.Name == t.Name }); j >= 0 {
			schedules[i].Last = latest[j]
		}
	}
	return schedules, nil
}

func (s *TaskService) RunSchedule(ctx context.Context, name string) error {
	if !slices.ContainsFunc(s.queue.Schedules(), func(t config.TaskConfig) bool { return t.Name == name }) {
		return apperror.NotFound("schedule_not_found", "no configured task of that name")
	}
	ok, err := s.queue.RunSchedule(ctx, name)
	if err == nil && !ok {
		err = apperror.Conflict("schedule_unfinished", "the last task it made is yet to finish")
	}
	return err
}

func (s *TaskService) Retry(ctx context.Context, ids []string) (int, error) {
	return s.queue.Requeue(ctx, ids)
}

func (s *TaskService) RetryMatching(ctx context.Context, f repository.TaskFilter) (int, error) {
	f.States = []string{model.TaskStatusFailed}
	ids, err := s.repo.Task.IDs(ctx, f)
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	return s.queue.Requeue(ctx, ids)
}

func (s *TaskService) RunNow(ctx context.Context, id string) error {
	ok, err := s.queue.RunNow(ctx, id)
	if err == nil && !ok {
		err = apperror.BadRequest("task_run_not_queued", "only a queued task can be run now")
	}
	return err
}

func (s *TaskService) Cancel(ctx context.Context, id string) error {
	ok, err := s.queue.Cancel(ctx, id)
	if err == nil && !ok {
		err = apperror.BadRequest("task_cancel_not_queued", "only a queued task can be cancelled")
	}
	return err
}

func (s *TaskService) Batch(ctx context.Context, id string) (*model.Task, error) {
	batch, err := s.repo.Task.Batch(ctx, id)
	if err == nil && batch == nil {
		err = apperror.NotFound("batch_not_found", "batch not found")
	}
	return batch, err
}

func (s *TaskService) CancelBatch(ctx context.Context, id string) (int, error) {
	n, err := s.queue.CancelBatch(ctx, id)
	if err == nil && n == 0 {
		err = apperror.BadRequest("batch_none_queued", "the batch has no queued task")
	}
	return n, err
}

func (s *TaskService) Purge(ctx context.Context, task *model.Task) error {
	before, err := purgeCutoff(task)
	if err != nil {
		return err
	}
	n, err := s.repo.Task.DeleteFinishedBefore(ctx, before)
	if err == nil {
		slog.Info("Purged finished tasks", "count", n, "before", before)
	}
	return err
}
