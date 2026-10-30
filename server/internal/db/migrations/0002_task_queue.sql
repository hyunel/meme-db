-- Claim reads each job type's due tasks on their own.
DROP INDEX IF EXISTS jobs.idx_tasks_queue;
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON jobs.tasks_active(job_type, priority DESC, run_at ASC);
