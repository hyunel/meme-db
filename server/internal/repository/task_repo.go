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

const taskSelectColumns = `id, owner_id, parent_task_id, job_type, payload, status, error_message, priority, cron, attempts, run_at, started_at, finished_at, created_at, updated_at`

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

// Claim leases up to limit due tasks: pending tasks whose run_at has passed, plus
// running tasks whose lease expired (crashed or stuck workers). Every transition
// out of 'running' is guarded by the attempts value returned here, so a worker
// whose lease was taken over cannot overwrite newer state.
func (r *TaskRepository) Claim(ctx context.Context, limit int, lease time.Duration) ([]*model.Task, error) {
	query := fmt.Sprintf(`
		WITH picked AS MATERIALIZED (
			SELECT id AS task_id, status AS task_status FROM jobs.tasks
			WHERE (status = 'pending' AND run_at <= CURRENT_TIMESTAMP)
			   OR (status = 'running' AND started_at < CURRENT_TIMESTAMP - make_interval(secs => $2))
			ORDER BY priority DESC, run_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE jobs.tasks t
		SET status = 'running', attempts = t.attempts + 1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		FROM picked p
		WHERE t.id = p.task_id AND t.status = p.task_status
		RETURNING %s
	`, taskSelectColumns)

	rows, err := r.db.Query(ctx, query, limit, lease.Seconds())
	if err != nil {
		return nil, fmt.Errorf("failed to claim tasks: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Task])
}

// Finish moves a claimed task to a terminal status (completed or failed).
func (r *TaskRepository) Finish(ctx context.Context, id string, attempts int, status string, errorMessage *string) error {
	query := `
		UPDATE jobs.tasks
		SET status = $3, error_message = $4, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
	`
	if _, err := r.db.Exec(ctx, query, id, attempts, status, errorMessage); err != nil {
		return fmt.Errorf("failed to finish task: %w", err)
	}
	return nil
}

// Retry puts a claimed task back into the queue, due at runAt.
func (r *TaskRepository) Retry(ctx context.Context, id string, attempts int, runAt time.Time, errorMessage string) error {
	query := `
		UPDATE jobs.tasks
		SET status = 'pending', run_at = $3, error_message = $4, started_at = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
	`
	if _, err := r.db.Exec(ctx, query, id, attempts, runAt, errorMessage); err != nil {
		return fmt.Errorf("failed to retry task: %w", err)
	}
	return nil
}

// Release hands a claimed task back without counting the attempt (used on shutdown).
func (r *TaskRepository) Release(ctx context.Context, id string, attempts int) error {
	query := `
		UPDATE jobs.tasks
		SET status = 'pending', attempts = attempts - 1, started_at = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
	`
	if _, err := r.db.Exec(ctx, query, id, attempts); err != nil {
		return fmt.Errorf("failed to release task: %w", err)
	}
	return nil
}

// Reschedule ends a run of a recurring (cron) task: the run is recorded as a history
// row with the given terminal status, and the task is reset to run again at next.
func (r *TaskRepository) Reschedule(ctx context.Context, task *model.Task, status string, errorMessage *string, next time.Time) error {
	query := `
		WITH reset AS (
			UPDATE jobs.tasks
			SET status = 'pending', run_at = $3, attempts = 0, started_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
			RETURNING id, owner_id, job_type, payload, priority, cron
		)
		INSERT INTO jobs.tasks (owner_id, parent_task_id, job_type, payload, status, priority, cron, attempts, run_at, started_at, finished_at, error_message)
		SELECT owner_id, id, job_type, payload, $4::varchar, priority, cron, $2::int, $5::timestamptz, $6::timestamptz, CURRENT_TIMESTAMP, $7::text
		FROM reset
	`
	_, err := r.db.Exec(ctx, query, task.ID, task.Attempts, next, status, task.RunAt, task.StartedAt, errorMessage)
	if err != nil {
		return fmt.Errorf("failed to reschedule task: %w", err)
	}
	return nil
}
