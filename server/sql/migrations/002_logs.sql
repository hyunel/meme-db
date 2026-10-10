-- Stores service logs for the admin log viewer.
-- Run once: psql "$DATABASE_URL" -f server/sql/migrations/002_logs.sql
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    time TIMESTAMPTZ NOT NULL,
    level VARCHAR(10) NOT NULL,               -- debug | info | warn | error
    message TEXT NOT NULL,
    attrs JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_logs_time ON ops.logs(time);
