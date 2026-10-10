package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

// TaskQueue performs administrative transitions that must run the job types' hooks.
type TaskQueue interface {
	Requeue(ctx context.Context, ids []string) (int, error)
	Cancel(ctx context.Context, id string) (bool, error)
	RunNow(ctx context.Context, id string) (bool, error)
}

// TaskService lets administrators inspect and steer background tasks.
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

// Summary counts tasks per job type; the *InRange counts cover tasks finished within finished.
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
		return nil, apperror.NotFound("任务不存在")
	}
	runs, err := s.repo.Task.Runs(ctx, id, 50)
	if err != nil {
		return nil, err
	}
	return &TaskDetail{Task: task, Runs: runs}, nil
}

// Retry requeues the failed tasks among ids and returns how many were requeued.
func (s *TaskService) Retry(ctx context.Context, ids []string) (int, error) {
	return s.queue.Requeue(ctx, ids)
}

func (s *TaskService) RunNow(ctx context.Context, id string) error {
	ok, err := s.queue.RunNow(ctx, id)
	if err == nil && !ok {
		err = apperror.BadRequest("只有排队中的任务可以立即执行")
	}
	return err
}

func (s *TaskService) Cancel(ctx context.Context, id string) error {
	ok, err := s.queue.Cancel(ctx, id)
	if err == nil && !ok {
		err = apperror.BadRequest("只有排队中的任务可以取消")
	}
	return err
}
