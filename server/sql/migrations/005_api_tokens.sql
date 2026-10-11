-- Adds personal API tokens.
-- Run once: psql "$DATABASE_URL" -f server/sql/migrations/005_api_tokens.sql
CREATE TABLE IF NOT EXISTS iam.api_tokens (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL,      -- SHA-256 of the secret, which is shown only once
    hint VARCHAR(4) NOT NULL,                 -- Last characters of the secret, to tell tokens apart
    scope VARCHAR(10) NOT NULL,               -- read | write | admin
    expires_at TIMESTAMPTZ,                   -- NULL = never
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON iam.api_tokens(user_id);
