package worker

import (
	"context"
	"errors"

	"github.com/hyunel/MemeDB/internal/model"
)

// TaskHandler executes tasks of one job type.
type TaskHandler interface {
	// Handle runs a single attempt. A nil error completes the task; any other error is
	// retried with backoff, unless wrapped with Permanent or attempts are exhausted.
	Handle(ctx context.Context, task *model.Task) error
}

// FailureHandler is optionally implemented by handlers that must react once a task has
// permanently failed, e.g. to mark domain state as failed. If it returns an error the
// task stays leased, so the hook runs again after the lease expires.
type FailureHandler interface {
	OnFailure(ctx context.Context, task *model.Task, cause error) error
}

// RequeueHandler is optionally implemented by handlers whose domain state must follow a
// failed task back into the queue (see Worker.Requeue).
type RequeueHandler interface {
	OnRequeue(ctx context.Context, task *model.Task) error
}

type permanentError struct{ err error }

func (e *permanentError) Error() string { return e.err.Error() }
func (e *permanentError) Unwrap() error { return e.err }

// Permanent marks err as not worth retrying: the task fails without further attempts.
func Permanent(err error) error {
	return &permanentError{err: err}
}

func isPermanent(err error) bool {
	var p *permanentError
	return errors.As(err, &p)
}
