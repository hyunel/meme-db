package worker

import (
	"context"
	"errors"

	"github.com/hyunel/MemeDB/internal/model"
)

type TaskHandler interface {
	// A nil error completes the task; a busy one waits its turn again, not as an attempt; others are retried unless
	// Permanent or out of attempts.
	Handle(ctx context.Context, task *model.Task) error
}

// HandlerFunc handles a job type with a function.
type HandlerFunc func(ctx context.Context, task *model.Task) error

func (f HandlerFunc) Handle(ctx context.Context, task *model.Task) error { return f(ctx, task) }

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

// busy is an error by which a dependency turned the task away for now, as it has enough to do.
func busy(err error) bool {
	var b interface{ Busy() bool }
	return errors.As(err, &b) && b.Busy()
}
