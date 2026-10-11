-- Splits tags into spellings (labels) and the tags they mean, so near-duplicate spellings share one tag.
-- Run once: psql "$DATABASE_URL" -f server/sql/migrations/004_tag_labels.sql
-- The queued resolve_labels task then groups the existing spellings into tags; it needs the inference service.
BEGIN;

CREATE FUNCTION library.label_key(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN btrim(regexp_replace(lower(normalize(name, NFKC)), '[\s_/"''“”‘’《》「」『』-]+', ' ', 'g'));

-- Each existing tag is a spelling; its links keep pointing at it.
ALTER TABLE library.tags RENAME TO labels;
ALTER TABLE library.labels RENAME CONSTRAINT tags_pkey TO labels_pkey;
ALTER TABLE library.labels RENAME CONSTRAINT tags_name_key TO labels_name_key;
ALTER TABLE library.asset_tags RENAME COLUMN tag_id TO label_id;
ALTER TABLE library.asset_tags RENAME CONSTRAINT asset_tags_tag_id_fkey TO asset_tags_label_id_fkey;
ALTER TABLE library.asset_tags RENAME CONSTRAINT asset_tags_asset_id_tag_id_user_id_key TO asset_tags_asset_id_label_id_user_id_key;
ALTER INDEX library.idx_asset_tags_tag RENAME TO idx_asset_tags_label;

CREATE TABLE library.tags (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(100) UNIQUE NOT NULL,
    embedding vector(1024),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tags_embedding ON library.tags USING hnsw (embedding vector_cosine_ops);

ALTER TABLE library.labels ADD COLUMN tag_id UUID REFERENCES library.tags(id) ON DELETE CASCADE;
CREATE INDEX idx_labels_key ON library.labels(library.label_key(name));
CREATE INDEX idx_labels_tag ON library.labels(tag_id);

INSERT INTO jobs.tasks (job_type, payload) VALUES ('resolve_labels', '{}');

COMMIT;
