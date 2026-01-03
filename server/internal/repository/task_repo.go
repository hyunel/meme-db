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

const taskSelectColumns = `id, owner_id, parent_task_id, job_type, payload, status, error_message, priority, cron, run_at, started_at, finished_at, created_at, updated_at`

type TaskRepository struct {
	db db.DBTX
}

func (r *TaskRepository) Create(ctx context.Context, jobType string, payload interface{}) (*model.Task, error) {
	return r.CreateWithOpts(ctx, jobType, payload, nil)
}

func (r *TaskRepository) CreateWithOpts(ctx context.Context, jobType string, payload interface{}, opts *TaskOpts) (*model.Task, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

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
		cron = opts.Cron
	}

	query := fmt.Sprintf(`
		INSERT INTO jobs.tasks (owner_id, job_type, payload, status, priority, run_at, cron)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING %s
	`, taskSelectColumns)

	rows, err := r.db.Query(ctx, query, ownerID, jobType, payloadBytes, model.TaskStatusPending, priority, runAt, cron)
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}
	task, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Task])
	if err != nil {
		return nil, fmt.Errorf("failed to scan created task: %w", err)
	}
	return &task, nil
}

func (r *TaskRepository) GetNextPending(ctx context.Context) (*model.Task, error) {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = (
			SELECT id FROM jobs.tasks
			WHERE status = $1 AND run_at <= CURRENT_TIMESTAMP
			  AND (started_at IS NULL OR started_at < CURRENT_TIMESTAMP - INTERVAL '%d minutes')
			ORDER BY priority DESC, run_at ASC
			FOR UPDATE SKIP LOCKED LIMIT 1
		)
		RETURNING %s
	`, model.TaskProcessingTimeout, taskSelectColumns)

	rows, err := r.db.Query(ctx, query, model.TaskStatusPending)
	if err != nil {
		return nil, err
	}
	task, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Task])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &task, nil
}

func (r *TaskRepository) UpdateStatus(ctx context.Context, id string, status string, errorMessage *string) error {
	query := `
		UPDATE jobs.tasks
		SET status = $1::VARCHAR(20), error_message = $2,
		    finished_at = CASE WHEN $1::VARCHAR(20) IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE finished_at END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3::uuid
	`
	_, err := r.db.Exec(ctx, query, status, errorMessage, id)
	return err
}

func (r *TaskRepository) CreateHistory(ctx context.Context, taskID string, historyStatus string, finishedAt *time.Time, errorMessage *string) error {
	if historyStatus != model.TaskStatusCompleted && historyStatus != model.TaskStatusFailed {
		return fmt.Errorf("history task status must be completed or failed, got: %s", historyStatus)
	}

	query := `
		INSERT INTO jobs.tasks (owner_id, parent_task_id, job_type, payload, status, priority, cron, run_at, started_at, finished_at, error_message)
		SELECT owner_id, id, job_type, payload, $1, priority, cron, run_at, started_at, $2, $3
		FROM jobs.tasks WHERE id = $4::uuid
	`
	_, err := r.db.Exec(ctx, query, historyStatus, finishedAt, errorMessage, taskID)
	if err != nil {
		return fmt.Errorf("failed to create task history: %w", err)
	}
	return nil
}

func (r *TaskRepository) Reset(ctx context.Context, taskID string, runAt time.Time, payload interface{}) error {
	query := `
		UPDATE jobs.tasks
		SET status = $1, run_at = $2, payload = $3, finished_at = NULL, started_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4::uuid
	`
	_, err := r.db.Exec(ctx, query, model.TaskStatusPending, runAt, payload, taskID)
	if err != nil {
		return fmt.Errorf("failed to reset task: %w", err)
	}
	return nil
}
