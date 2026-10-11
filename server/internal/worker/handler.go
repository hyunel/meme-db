package worker

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
)

type TaskHandler interface {
	// A nil error completes the task; others are retried unless Permanent or out of attempts.
	Handle(ctx context.Context, task *model.Task) error
}

// FailureHandler runs once a task has permanently failed; on error the task stays leased and it runs again later.
type FailureHandler interface {
	OnFailure(ctx context.Context, task *model.Task, cause error) error
}

// RequeueHandler runs when an admin requeues failed tasks.
type RequeueHandler interface {
	OnRequeue(ctx context.Context, task *model.Task) error
}

type permanentError struct{ err error }

func (e *permanentError) Error() string { return e.err.Error() }
func (e *permanentError) Unwrap() error { return e.err }

func Permanent(err error) error {
	return &permanentError{err: err}
}
