package worker

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
)

type TaskHandler interface {
	Handle(ctx context.Context, task *model.Task) error
}
