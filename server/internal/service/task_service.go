package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type TaskQueue interface {
	Requeue(ctx context.Context, ids []string) (int, error)
	Cancel(ctx context.Context, id string) (bool, error)
	CancelBatch(ctx context.Context, batchID string) (int, error)
	RunNow(ctx context.Context, id string) (bool, error)
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

type TaskDetail struct {
	*model.Task
	Runs []*model.Task `json:"runs"` // Latest runs of a recurring task
}

func (s *TaskService) Get(ctx context.Context, id string) (*TaskDetail, error) {
	task, err := s.repo.Task.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, apperror.NotFound("task_not_found", "task not found")
	}
	runs, err := s.repo.Task.Runs(ctx, id, 50)
	if err != nil {
		return nil, err
	}
	return &TaskDetail{Task: task, Runs: runs}, nil
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

func (s *TaskService) Batches(ctx context.Context, limit int) ([]*model.TaskBatch, error) {
	return s.repo.Task.Batches(ctx, limit)
}

func (s *TaskService) CancelBatch(ctx context.Context, id string) (int, error) {
	n, err := s.queue.CancelBatch(ctx, id)
	if err == nil && n == 0 {
		err = apperror.BadRequest("batch_none_queued", "the batch has no queued task")
	}
	return n, err
}
