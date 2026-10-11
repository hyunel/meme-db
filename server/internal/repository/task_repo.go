package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const taskSelectColumns = `id, owner_id, parent_task_id, job_type, payload, status, error_message, priority, cron, attempts, run_at, started_at, finished_at, created_at, updated_at,
	COALESCE(context->'attempts', '[]') AS history`

func withAttempt(ctx, ok, errorMessage string) string {
	return fmt.Sprintf(`jsonb_set(COALESCE(%[1]s, '{}'), '{attempts}',
		COALESCE(%[1]s->'attempts', '[]') || jsonb_build_object('at', CURRENT_TIMESTAMP, 'ok', %[2]s, 'error', %[3]s))`,
		ctx, ok, errorMessage)
}

type TaskRepository struct {
	db db.DBTX
}

type TaskOpts struct {
	OwnerID  *string
	Priority int
	RunAt    *time.Time // Defaults to now
	Cron     *string
}

func (r *TaskRepository) Enqueue(ctx context.Context, jobType string, payloads []any, opts TaskOpts) error {
	if len(payloads) == 0 {
		return nil
	}
	encoded := make([]string, len(payloads))
	for i, p := range payloads {
		b, err := json.Marshal(p)
		if err != nil {
			return fmt.Errorf("failed to marshal payload: %w", err)
		}
		encoded[i] = string(b)
	}

	query := `
		INSERT INTO jobs.tasks (owner_id, job_type, payload, status, priority, run_at, cron)
		SELECT $1::uuid, $2, p, 'pending', $3, COALESCE($4, CURRENT_TIMESTAMP), $5
		FROM unnest($6::jsonb[]) p
	`
	if _, err := r.db.Exec(ctx, query, opts.OwnerID, jobType, opts.Priority, opts.RunAt, opts.Cron, encoded); err != nil {
		return fmt.Errorf("failed to create tasks: %w", err)
	}
	return nil
}

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

	tasks, err := collectAll[model.Task](r.db.Query(ctx, query, limit, lease.Seconds()))
	if err != nil {
		return nil, fmt.Errorf("failed to claim tasks: %w", err)
	}
	return tasks, nil
}

func (r *TaskRepository) Finish(ctx context.Context, id string, attempts int, status string, errorMessage *string) error {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = $3::varchar, error_message = $4, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, context = %s
		WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
	`, withAttempt("context", "$3::varchar = 'completed'", "$4::text"))
	if _, err := r.db.Exec(ctx, query, id, attempts, status, errorMessage); err != nil {
		return fmt.Errorf("failed to finish task: %w", err)
	}
	return nil
}

func (r *TaskRepository) Retry(ctx context.Context, id string, attempts int, runAt time.Time, errorMessage string) error {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = 'pending', run_at = $3, error_message = $4, started_at = NULL, updated_at = CURRENT_TIMESTAMP, context = %s
		WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
	`, withAttempt("context", "false", "$4::text"))
	if _, err := r.db.Exec(ctx, query, id, attempts, runAt, errorMessage); err != nil {
		return fmt.Errorf("failed to retry task: %w", err)
	}
	return nil
}

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

func (r *TaskRepository) Reschedule(ctx context.Context, task *model.Task, status string, errorMessage *string, next time.Time) error {
	query := fmt.Sprintf(`
		WITH run AS (
			SELECT context FROM jobs.tasks WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
		), reset AS (
			UPDATE jobs.tasks
			SET status = 'pending', run_at = $3, attempts = 0, started_at = NULL, error_message = NULL,
				context = context - 'attempts', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1::uuid AND attempts = $2 AND status = 'running'
			RETURNING id, owner_id, job_type, payload, priority, cron
		)
		INSERT INTO jobs.tasks (owner_id, parent_task_id, job_type, payload, status, priority, cron, attempts, run_at, started_at, finished_at, error_message, context)
		SELECT owner_id, id, job_type, payload, $4::varchar, priority, cron, $2::int, $5::timestamptz, $6::timestamptz, CURRENT_TIMESTAMP, $7::text, %s
		FROM reset
	`, withAttempt("(SELECT context FROM run)", "$4::varchar = 'completed'", "$7::text"))
	_, err := r.db.Exec(ctx, query, task.ID, task.Attempts, next, status, task.RunAt, task.StartedAt, errorMessage)
	if err != nil {
		return fmt.Errorf("failed to reschedule task: %w", err)
	}
	return nil
}

func (r *TaskRepository) Requeue(ctx context.Context, ids []string) ([]*model.Task, error) {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = 'pending', attempts = 0, run_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL,
			error_message = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = ANY($1::uuid[]) AND status = 'failed' AND parent_task_id IS NULL
		RETURNING %s
	`, taskSelectColumns)
	return collectAll[model.Task](r.db.Query(ctx, query, ids))
}

func (r *TaskRepository) Cancel(ctx context.Context, id, reason string) (*model.Task, error) {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = 'failed', error_message = $2, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND status = 'pending'
		RETURNING %s
	`, taskSelectColumns)
	return collectOne[model.Task](r.db.Query(ctx, query, id, reason))
}

func (r *TaskRepository) RunNow(ctx context.Context, id string) (bool, error) {
	query := `
		UPDATE jobs.tasks SET run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND status = 'pending'
	`
	tag, err := r.db.Exec(ctx, query, id)
	return tag.RowsAffected() > 0, err
}

func (r *TaskRepository) Get(ctx context.Context, id string) (*model.Task, error) {
	query := fmt.Sprintf(`SELECT %s FROM jobs.tasks WHERE id = $1::uuid`, taskSelectColumns)
	return collectOne[model.Task](r.db.Query(ctx, query, id))
}

func (r *TaskRepository) Runs(ctx context.Context, parentID string, limit int) ([]*model.Task, error) {
	query := fmt.Sprintf(`SELECT %s FROM jobs.tasks WHERE parent_task_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, taskSelectColumns)
	return collectAll[model.Task](r.db.Query(ctx, query, parentID, limit))
}

var taskStates = map[string]string{
	"pending":   "(status = 'pending' AND attempts = 0)",
	"retrying":  "(status = 'pending' AND attempts > 0)",
	"running":   "status = 'running'",
	"completed": "status = 'completed'",
	"failed":    "status = 'failed'",
}

type TaskFilter struct {
	States    []string // Keys of taskStates
	JobType   string
	Query     string // Matches the task ID or the asset it works on
	Created   TimeRange
	Recurring bool
	Sort      string // due (default: running, retrying, then by run_at) | created | finished
}

func (f TaskFilter) where() filter {
	var w filter
	var states []string
	for _, s := range f.States {
		if cond, ok := taskStates[s]; ok {
			states = append(states, cond)
		}
	}
	if len(states) > 0 {
		w.where("(" + strings.Join(states, " OR ") + ")")
	}
	if f.JobType != "" {
		w.where("job_type = " + w.arg(f.JobType))
	}
	if f.Query != "" {
		p := w.arg(f.Query)
		w.where(fmt.Sprintf("(id::text = %[1]s OR payload->>'asset_id' = %[1]s)", p))
	}
	if f.Recurring {
		w.where("cron IS NOT NULL")
	}
	w.timeRange("created_at", f.Created)
	return w
}

func (r *TaskRepository) List(ctx context.Context, f TaskFilter, page Page) ([]*model.Task, int, error) {
	w := f.where()
	total, err := count(ctx, r.db, "SELECT count(*) FROM jobs.tasks "+w.clause(), w.args...)
	if err != nil {
		return nil, 0, err
	}

	order := map[string]string{"created": "created_at DESC", "finished": "finished_at DESC NULLS LAST"}[f.Sort]
	if order == "" {
		order = "CASE WHEN status = 'running' THEN 0 WHEN attempts > 0 THEN 1 ELSE 2 END, run_at"
	}
	query := fmt.Sprintf(`SELECT %s FROM jobs.tasks %s ORDER BY %s %s`, taskSelectColumns, w.clause(), order, page.clause())
	tasks, err := collectAll[model.Task](r.db.Query(ctx, query, w.args...))
	return tasks, total, err
}

func (r *TaskRepository) IDs(ctx context.Context, f TaskFilter) ([]string, error) {
	w := f.where()
	return collectScalars[string](r.db.Query(ctx, "SELECT id::text FROM jobs.tasks "+w.clause(), w.args...))
}

func (r *TaskRepository) Summary(ctx context.Context, finished TimeRange) ([]*model.TaskTypeCounts, error) {
	var w filter
	w.where("status IN ('completed', 'failed')")
	w.timeRange("finished_at", finished)
	inRange := strings.Join(w.conds, " AND ")

	query := fmt.Sprintf(`
		SELECT job_type,
			count(*) FILTER (WHERE %s) AS pending,
			count(*) FILTER (WHERE %s) AS retrying,
			count(*) FILTER (WHERE status = 'running') AS running,
			count(*) FILTER (WHERE status = 'completed') AS completed,
			count(*) FILTER (WHERE status = 'failed') AS failed,
			count(*) FILTER (WHERE status = 'completed' AND %[3]s) AS completed_in_range,
			count(*) FILTER (WHERE status = 'failed' AND %[3]s) AS failed_in_range
		FROM jobs.tasks GROUP BY job_type ORDER BY job_type
	`, taskStates["pending"], taskStates["retrying"], inRange)
	return collectAll[model.TaskTypeCounts](r.db.Query(ctx, query, w.args...))
}
