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

const taskSelectColumns = `id, owner_id, name, batch_id, job_type, payload, status, error_message, priority, attempts, max_attempts, timeout_secs, run_at, started_at, finished_at, created_at, updated_at,
	COALESCE(context->'attempts', '[]') AS history, NULL::jsonb AS batch`

// tasksByBatch lists the tasks outside batches beside a row for each batch, whose status is its tasks' most pressing:
// running, then waiting (to retry when none waits for a first attempt), then failed.
var tasksByBatch = fmt.Sprintf(`
	SELECT %s FROM jobs.tasks WHERE batch_id IS NULL
	UNION ALL
	SELECT batch_id, NULL, NULL, batch_id, min(job_type), '{}'::jsonb,
		CASE WHEN bool_or(status = 'running') THEN 'running' WHEN bool_or(status = 'pending') THEN 'pending'
			WHEN bool_or(status = 'failed') THEN 'failed' ELSE 'completed' END,
		NULL, max(priority), CASE WHEN bool_or(status = 'pending' AND attempts = 0) THEN 0 ELSE 1 END,
		max(max_attempts), max(timeout_secs),
		COALESCE(min(run_at) FILTER (WHERE status IN ('pending', 'running')), min(run_at)), min(started_at),
		CASE WHEN bool_and(status IN ('completed', 'failed')) THEN max(finished_at) END, min(created_at), max(updated_at),
		'[]'::jsonb,
		jsonb_build_object('total', count(*), 'pending', count(*) FILTER (WHERE status = 'pending'),
			'running', count(*) FILTER (WHERE status = 'running'), 'completed', count(*) FILTER (WHERE status = 'completed'),
			'failed', count(*) FILTER (WHERE status = 'failed'))
	FROM jobs.tasks WHERE batch_id IS NOT NULL GROUP BY batch_id
`, taskSelectColumns)

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
	BatchID  *string
}

func (r *TaskRepository) Enqueue(ctx context.Context, jobType string, payloads []any, opts TaskOpts) error {
	if len(payloads) == 0 {
		return nil
	}
	policy, ok := model.JobPolicies[jobType]
	if !ok {
		return fmt.Errorf("no policy for job type %s", jobType)
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
		INSERT INTO jobs.tasks (owner_id, job_type, payload, status, priority, run_at, max_attempts, timeout_secs, batch_id)
		SELECT $1::uuid, $2, p, 'pending', $3, COALESCE($4, CURRENT_TIMESTAMP), $6, $7, $8::uuid
		FROM unnest($5::jsonb[]) p
	`
	_, err := r.db.Exec(ctx, query, opts.OwnerID, jobType, opts.Priority, opts.RunAt, encoded, policy.MaxAttempts, int(policy.Timeout.Seconds()), opts.BatchID)
	if err != nil {
		return fmt.Errorf("failed to create tasks: %w", err)
	}
	return nil
}

// EnqueueScheduled makes a task of a configured one, unless its last is unfinished.
func (r *TaskRepository) EnqueueScheduled(ctx context.Context, name, jobType string, payload []byte) (bool, error) {
	policy, ok := model.JobPolicies[jobType]
	if !ok {
		return false, fmt.Errorf("no policy for job type %s", jobType)
	}
	query := `
		INSERT INTO jobs.tasks (name, job_type, payload, status, priority, max_attempts, timeout_secs)
		VALUES ($1, $2, $3, 'pending', $4, $5, $6)
		ON CONFLICT DO NOTHING
	`
	tag, err := r.db.Exec(ctx, query, name, jobType, payload, model.PriorityNormal, policy.MaxAttempts, int(policy.Timeout.Seconds()))
	if err != nil {
		return false, fmt.Errorf("failed to enqueue %s: %w", name, err)
	}
	return tag.RowsAffected() > 0, nil
}

// LatestScheduled returns the latest task each configured one of names made.
func (r *TaskRepository) LatestScheduled(ctx context.Context, names []string) ([]*model.Task, error) {
	query := fmt.Sprintf(`SELECT DISTINCT ON (name) %s FROM jobs.tasks WHERE name = ANY($1) ORDER BY name, created_at DESC`, taskSelectColumns)
	return collectAll[model.Task](r.db.Query(ctx, query, names))
}

// Claim leases due tasks, and running ones whose lease ran out: twice their timeout, so a live attempt is never reclaimed.
func (r *TaskRepository) Claim(ctx context.Context, limit int) ([]*model.Task, error) {
	query := fmt.Sprintf(`
		WITH picked AS MATERIALIZED (
			SELECT id AS task_id, status AS task_status FROM jobs.tasks
			WHERE (status = 'pending' AND run_at <= CURRENT_TIMESTAMP)
			   OR (status = 'running' AND started_at < CURRENT_TIMESTAMP - make_interval(secs => 2 * timeout_secs))
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

	tasks, err := collectAll[model.Task](r.db.Query(ctx, query, limit))
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

func (r *TaskRepository) Requeue(ctx context.Context, ids []string) ([]*model.Task, error) {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = 'pending', attempts = 0, run_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL,
			error_message = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = ANY($1::uuid[]) AND status = 'failed' AND name IS NULL -- One a configured task made is retried by running that again
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

func (r *TaskRepository) CancelBatch(ctx context.Context, batchID, reason string) ([]*model.Task, error) {
	query := fmt.Sprintf(`
		UPDATE jobs.tasks
		SET status = 'failed', error_message = $2, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE batch_id = $1::uuid AND status = 'pending'
		RETURNING %s
	`, taskSelectColumns)
	return collectAll[model.Task](r.db.Query(ctx, query, batchID, reason))
}

// Batch is the row standing for a batch, as a grouped list has it.
func (r *TaskRepository) Batch(ctx context.Context, id string) (*model.Task, error) {
	return collectOne[model.Task](r.db.Query(ctx, `SELECT * FROM (`+tasksByBatch+`) t WHERE id = $1::uuid AND batch IS NOT NULL`, id))
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
	Batch     string
	Group     bool   // Rolls each batch up into one row, unless the filter picks out a batch or a task
	Query     string // Matches the task ID, the asset it works on or the configured task that made it
	Created   TimeRange
	Scheduled bool   // Made by configured tasks
	Sort      string // due (default: running, retrying, pending by run_at, then the latest finished) | created | finished
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
	if f.Batch != "" {
		w.where("batch_id = " + w.arg(f.Batch) + "::uuid")
	}
	if f.Query != "" {
		p := w.arg(f.Query)
		w.where(fmt.Sprintf("(id::text = %[1]s OR payload->>'asset_id' = %[1]s OR name = %[1]s)", p))
	}
	if f.Scheduled {
		w.where("name IS NOT NULL")
	}
	w.timeRange("created_at", f.Created)
	return w
}

func (r *TaskRepository) List(ctx context.Context, f TaskFilter, page Page) ([]*model.Task, int, error) {
	from, columns := "jobs.tasks", taskSelectColumns
	if f.Group && f.Batch == "" && f.Query == "" {
		from, columns = "("+tasksByBatch+") t", "*"
	}
	w := f.where()
	total, err := count(ctx, r.db, "SELECT count(*) FROM "+from+" "+w.clause(), w.args...)
	if err != nil {
		return nil, 0, err
	}

	order := map[string]string{"created": "created_at DESC", "finished": "finished_at DESC NULLS LAST"}[f.Sort]
	if order == "" {
		order = `CASE WHEN status = 'running' THEN 0 WHEN status = 'pending' AND attempts > 0 THEN 1 WHEN status = 'pending' THEN 2 ELSE 3 END,
			CASE WHEN status IN ('pending', 'running') THEN run_at END, finished_at DESC`
	}
	query := fmt.Sprintf(`SELECT %s FROM %s %s ORDER BY %s %s`, columns, from, w.clause(), order, page.clause())
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

// DeleteFinishedBefore deletes the tasks finished before t, those of a batch once all of it has, returning how many.
func (r *TaskRepository) DeleteFinishedBefore(ctx context.Context, t time.Time) (int64, error) {
	query := `
		DELETE FROM jobs.tasks_history WHERE finished_at < $1
			AND (batch_id IS NULL OR batch_id NOT IN (
				SELECT batch_id FROM jobs.tasks WHERE batch_id IS NOT NULL AND (status IN ('pending', 'running') OR finished_at >= $1)))
	`
	tag, err := r.db.Exec(ctx, query, t)
	return tag.RowsAffected(), err
}
