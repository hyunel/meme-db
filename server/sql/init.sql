-- ============================================================================
-- EXTENSIONS & TYPES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TYPE node_type AS ENUM ('FOLDER', 'FILE');

-- ============================================================================
-- SCHEMAS
-- ============================================================================
-- core    : Core data (assets, meme analysis)
-- iam     : Identity & Access Management (users, roles, API tokens)
-- library : User content (nodes, favorites, tags)
-- jobs    : Background task queue
-- ops     : Operational data (service logs)
--
-- Access control is enforced by the application's queries (owner / visibility filters).
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS library;
CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS ops;

-- ============================================================================
-- TABLES: IAM
-- ============================================================================
CREATE TABLE IF NOT EXISTS iam.users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | disabled
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Personal tokens for calling the API as their user.
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

-- ============================================================================
-- TABLES: Core
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.assets (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    file_hash CHAR(64) UNIQUE NOT NULL,       -- SHA-256 (deduplication key)
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    extension VARCHAR(10) NOT NULL,
    storage_path VARCHAR(255) NOT NULL,
    uploaded_by UUID REFERENCES iam.users(id) ON DELETE SET NULL, -- First uploader
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_created ON core.assets(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_uploader ON core.assets(uploaded_by, created_at);

CREATE TABLE IF NOT EXISTS core.meme_info (
    asset_id UUID PRIMARY KEY REFERENCES core.assets(id) ON DELETE CASCADE,
    vlm_json JSONB,
    ocr_text TEXT,
    metaphor_vector vector,                   -- Embeddings, sized and indexed for their models (core.embedding_models)
    semantic_vector vector,
    clip_vector vector,
    width INT,
    height INT,
    processing_status VARCHAR(20) DEFAULT 'pending',
    fail_reason TEXT,
    analyzed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meme_ocr ON core.meme_info USING GIN (ocr_text gin_trgm_ops);

-- The model the stored embeddings of each inference role come from: clip (core.meme_info.clip_vector) and
-- text_embedding (its other vectors and library.tags.embedding). The server adopts the inference service's models.
CREATE TABLE IF NOT EXISTS core.embedding_models (
    role TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- Popularity of each asset (favorites × 3 + library entries), kept by triggers so the popular list pages by an index.
-- Not a column of core.meme_info, where updating an indexed column would rewrite its vector indexes on every favorite.
CREATE TABLE IF NOT EXISTS core.meme_stats (
    asset_id UUID PRIMARY KEY REFERENCES core.assets(id) ON DELETE CASCADE,
    popularity INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_meme_stats_popularity ON core.meme_stats(popularity DESC, asset_id DESC);

CREATE OR REPLACE FUNCTION core.add_meme_stats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO core.meme_stats (asset_id) VALUES (NEW.id);
    RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER trg_assets_stats AFTER INSERT ON core.assets
    FOR EACH ROW EXECUTE FUNCTION core.add_meme_stats();

-- ============================================================================
-- TABLES: Library
-- ============================================================================
-- A node is public if it or any ancestor folder has is_public set.
CREATE TABLE IF NOT EXISTS library.nodes (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    owner_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES library.nodes(id) ON DELETE CASCADE,
    path ltree NOT NULL,                      -- Materialized path of ancestor ids (no hyphens)
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    asset_id UUID REFERENCES core.assets(id) ON DELETE CASCADE, -- NULL for folders
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE NULLS NOT DISTINCT (owner_id, parent_id, name) -- Within a folder, and at the root of a library
);

CREATE INDEX IF NOT EXISTS idx_nodes_path ON library.nodes USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_nodes_public_path ON library.nodes USING GIST (path) WHERE is_public;
CREATE INDEX IF NOT EXISTS idx_nodes_asset_owner ON library.nodes(asset_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_nodes_owner_parent ON library.nodes(owner_id, parent_id, id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON library.nodes(parent_id);

CREATE TABLE IF NOT EXISTS library.favorites (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES core.assets(id) ON DELETE CASCADE,
    node_id UUID REFERENCES library.nodes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_favorite_target CHECK (
        (asset_id IS NOT NULL AND node_id IS NULL) OR
        (asset_id IS NULL AND node_id IS NOT NULL)
    ),
    UNIQUE NULLS NOT DISTINCT (user_id, asset_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_asset ON library.favorites(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_favorites_node ON library.favorites(node_id) WHERE node_id IS NOT NULL;

-- Folders have no asset, so their nodes and favorites match no stats row.
CREATE OR REPLACE FUNCTION library.count_popularity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    weight INT := CASE TG_TABLE_NAME WHEN 'favorites' THEN 3 ELSE 1 END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE core.meme_stats SET popularity = popularity + weight WHERE asset_id = NEW.asset_id;
    ELSE
        UPDATE core.meme_stats SET popularity = popularity - weight WHERE asset_id = OLD.asset_id;
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER trg_nodes_popularity AFTER INSERT OR DELETE ON library.nodes
    FOR EACH ROW EXECUTE FUNCTION library.count_popularity();
CREATE OR REPLACE TRIGGER trg_favorites_popularity AFTER INSERT OR DELETE ON library.favorites
    FOR EACH ROW EXECUTE FUNCTION library.count_popularity();

-- Private links: whoever holds one may open the meme while its creator keeps it in their library,
-- or the folder with all it holds.
CREATE TABLE IF NOT EXISTS library.share_links (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Random, unlike the time-ordered ids, so it cannot be guessed
    owner_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES core.assets(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES library.nodes(id) ON DELETE CASCADE,
    view_count INT NOT NULL DEFAULT 0,        -- Page loads of the meme or folder by people other than its creator
    save_count INT NOT NULL DEFAULT 0,        -- Saves of the meme or folder to a library through it
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CHECK ((asset_id IS NULL) <> (folder_id IS NULL)),
    UNIQUE (owner_id, asset_id),
    UNIQUE (folder_id)
);

-- Spellings that differ only in case, width or separators share a key.
CREATE OR REPLACE FUNCTION library.label_key(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN btrim(regexp_replace(lower(normalize(name, NFKC)), '[\s_/"''“”‘’《》「」『』-]+', ' ', 'g'));

CREATE TABLE IF NOT EXISTS library.tags (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(100) UNIQUE NOT NULL,
    embedding vector,                       -- Of the founding spelling, which new spellings are matched against; NULL for a tag a user started, never merged
    hidden BOOLEAN NOT NULL DEFAULT FALSE,  -- Still matched, so its spellings don't come back as new tags, but never shown
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Every spelling given by the VLM or users, mapped to the tag it means.
CREATE TABLE IF NOT EXISTS library.labels (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(100) UNIQUE NOT NULL,
    tag_id UUID NOT NULL REFERENCES library.tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_labels_key ON library.labels(library.label_key(name));
CREATE INDEX IF NOT EXISTS idx_labels_tag ON library.labels(tag_id);

CREATE TABLE IF NOT EXISTS library.asset_tags (
    asset_id UUID NOT NULL REFERENCES core.assets(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES library.labels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES iam.users(id) ON DELETE CASCADE,  -- NULL = system tag
    UNIQUE NULLS NOT DISTINCT (asset_id, label_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_user ON library.asset_tags(asset_id, user_id);
CREATE INDEX IF NOT EXISTS idx_asset_tags_label ON library.asset_tags(label_id);

-- Files of active users that are public themselves or through a public ancestor folder.
CREATE OR REPLACE VIEW library.public_files AS
SELECT n.* FROM library.nodes n
JOIN iam.users u ON u.id = n.owner_id AND u.status = 'active'
WHERE n.type = 'FILE'
  AND EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> n.path);

-- ============================================================================
-- TABLES: Jobs (Partitioned Task Queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs.tasks (
    id UUID DEFAULT uuidv7(),
    owner_id UUID REFERENCES iam.users(id) ON DELETE CASCADE,
    parent_task_id UUID,
    batch_id UUID,                            -- Tasks an admin queued together, whose progress is the batch's
    job_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',     -- pending -> running -> completed | failed
    error_message TEXT,
    priority INT DEFAULT 0,
    cron VARCHAR(50),
    attempts INT NOT NULL DEFAULT 0,          -- Incremented on each claim; doubles as fencing token
    max_attempts INT NOT NULL,                -- Claims before the task fails for good, set by its job type
    timeout_secs INT NOT NULL,                -- Deadline of an attempt; its claim's lease lasts twice this
    run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,                   -- Lease start of the current attempt
    finished_at TIMESTAMPTZ,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, status)
) PARTITION BY LIST (status);

CREATE TABLE IF NOT EXISTS jobs.tasks_active PARTITION OF jobs.tasks FOR VALUES IN ('pending', 'running');
CREATE TABLE IF NOT EXISTS jobs.tasks_history PARTITION OF jobs.tasks FOR VALUES IN ('completed', 'failed');

CREATE INDEX IF NOT EXISTS idx_tasks_queue ON jobs.tasks_active(priority DESC, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_history ON jobs.tasks_history(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_asset ON jobs.tasks ((payload->>'asset_id'));
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON jobs.tasks (batch_id) WHERE batch_id IS NOT NULL;

-- ============================================================================
-- TABLES: Ops
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    time TIMESTAMPTZ NOT NULL,
    level VARCHAR(10) NOT NULL,               -- debug | info | warn | error
    message TEXT NOT NULL,
    attrs JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_logs_time ON ops.logs(time);
