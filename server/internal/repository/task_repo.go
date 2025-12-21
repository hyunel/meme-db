package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

type taskRepo struct {
	db db.DBTX
}

type TaskOpts struct {
	OwnerID  *string
	Priority int
	RunAt    time.Time
	Cron     *string
}

func NewTaskRepository(db db.DBTX) *taskRepo {
	return &taskRepo{db: db}
}

func (r *taskRepo) CreateTask(ctx context.Context, jobType string, payload interface{}) (*model.Task, error) {
	return r.CreateTaskWithOpts(ctx, jobType, payload, nil)
}

func (r *taskRepo) CreateTaskWithOpts(ctx context.Context, jobType string, payload interface{}, opts *TaskOpts) (*model.Task, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Default values
	var ownerID *string
	priority := 0
	runAt := time.Now()
	var cron *string

	if opts != nil {
		ownerID = opts.OwnerID
		priority = opts.Priority
		if !opts.RunAt.IsZero() {
			runAt = opts.RunAt
		}
		if opts.Cron != nil {
			cron = opts.Cron
		}
	}

	query := `
		INSERT INTO tasks (owner_id, job_type, payload, status, priority, run_at, cron, context)
		VALUES ($1, $2, $3, $4, $5, $6, $7, '{}')
		RETURNING id, owner_id, parent_task_id, job_type, payload, status, priority, cron, run_at, started_at, finished_at, context, created_at, updated_at
	`

	var task model.Task
	err = r.db.QueryRow(ctx, query, ownerID, jobType, payloadBytes, model.TaskStatusPending, priority, runAt, cron).Scan(
		&task.ID, &task.OwnerID, &task.ParentTaskID, &task.JobType, &task.Payload, &task.Status, &task.Priority, &task.Cron, &task.RunAt, &task.StartedAt, &task.FinishedAt, &task.Context, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	return &task, nil
}

func (r *taskRepo) GetNextPendingTask(ctx context.Context) (*model.Task, error) {
	// Atomic update and fetch using UPDATE ... RETURNING with subquery
	query := `
		UPDATE tasks
		SET status = $1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = (
			SELECT id
			FROM tasks
			WHERE status = $2 AND run_at <= $3
			ORDER BY priority DESC, run_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, parent_task_id, job_type, payload, status, priority, cron, run_at, started_at, finished_at, context, created_at, updated_at
	`

	var task model.Task
	err := r.db.QueryRow(ctx, query, model.TaskStatusProcessing, model.TaskStatusPending, time.Now()).Scan(
		&task.ID, &task.ParentTaskID, &task.JobType, &task.Payload, &task.Status, &task.Priority, &task.Cron, &task.RunAt, &task.StartedAt, &task.FinishedAt, &task.Context, &task.CreatedAt, &task.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil // No pending tasks
		}
		return nil, err
	}

	return &task, nil
}

func (r *taskRepo) UpdateTaskStatus(ctx context.Context, id string, status string, errorMessage *string) error {
	query := `
		UPDATE tasks
		SET status = $1::VARCHAR(20),
		    error_message = $2,
		    finished_at = CASE WHEN $1::VARCHAR(20) IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE finished_at END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3::uuid
	`
	_, err := r.db.Exec(ctx, query, status, errorMessage, id)
	return err
}

func (r *taskRepo) CreateHistoryFromTask(ctx context.Context, taskID string, historyStatus string, finishedAt *time.Time, errorMessage *string) error {
	if historyStatus != model.TaskStatusCompleted && historyStatus != model.TaskStatusFailed {
		return fmt.Errorf("history task status must be completed or failed, got: %s", historyStatus)
	}

	insertQuery := `
		INSERT INTO tasks (owner_id, parent_task_id, job_type, payload, status, priority, cron, run_at, started_at, finished_at, context, error_message)
		SELECT owner_id, id, job_type, payload, $1, priority, cron, run_at, started_at, $2, context, $3
		FROM tasks
		WHERE id = $4::uuid
	`
	_, err := r.db.Exec(ctx, insertQuery,
		historyStatus, // $1
		finishedAt,    // $2
		errorMessage,  // $3
		taskID,        // $4
	)
	if err != nil {
		return fmt.Errorf("failed to create task history: %w", err)
	}
	return nil
}

func (r *taskRepo) ResetTask(ctx context.Context, taskID string, runAt time.Time, taskContext interface{}) error {
	query := `
		UPDATE tasks
		SET status = $1, run_at = $2, context = $3, finished_at = NULL, started_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4::uuid
	`
	_, err := r.db.Exec(ctx, query, model.TaskStatusPending, runAt, taskContext, taskID)
	if err != nil {
		return fmt.Errorf("failed to reset task: %w", err)
	}
	return nil
}

func (r *taskRepo) ResetStaleTasks(ctx context.Context, duration time.Duration) error {
	query := `
		UPDATE tasks
		SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
		WHERE status = $3 AND updated_at < $4
	`
	cutoff := time.Now().Add(-duration)
	msg := "Recovered from stale state"
	_, err := r.db.Exec(ctx, query, model.TaskStatusPending, msg, model.TaskStatusProcessing, cutoff)
	return err
}
