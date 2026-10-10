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
-- iam     : Identity & Access Management (users, roles)
-- library : User content (nodes, favorites, tags)
-- jobs    : Background task queue
--
-- Access control is enforced by the application's queries (owner / visibility filters).
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS library;
CREATE SCHEMA IF NOT EXISTS jobs;

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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_created ON core.assets(created_at);

CREATE TABLE IF NOT EXISTS core.meme_info (
    asset_id UUID PRIMARY KEY REFERENCES core.assets(id) ON DELETE CASCADE,
    vlm_json JSONB,
    ocr_text TEXT,
    metaphor_vector vector(1024),
    semantic_vector vector(1024),
    clip_vector vector(768),
    width INT,
    height INT,
    processing_status VARCHAR(20) DEFAULT 'pending',
    fail_reason TEXT,
    analyzed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meme_sem ON core.meme_info USING hnsw (semantic_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_meme_meta ON core.meme_info USING hnsw (metaphor_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_meme_clip ON core.meme_info USING hnsw (clip_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_meme_ocr ON core.meme_info USING GIN (ocr_text gin_trgm_ops);

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
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_path ON library.nodes USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_nodes_public_path ON library.nodes USING GIST (path) WHERE is_public;
CREATE INDEX IF NOT EXISTS idx_nodes_asset_owner ON library.nodes(asset_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_nodes_owner_parent ON library.nodes(owner_id, parent_id);
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

CREATE TABLE IF NOT EXISTS library.tags (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS library.asset_tags (
    asset_id UUID NOT NULL REFERENCES core.assets(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES library.tags(id) ON DELETE CASCADE,
    user_id UUID REFERENCES iam.users(id) ON DELETE CASCADE,  -- NULL = system tag
    UNIQUE NULLS NOT DISTINCT (asset_id, tag_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_user ON library.asset_tags(asset_id, user_id);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON library.asset_tags(tag_id);

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
    job_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',     -- pending -> running -> completed | failed
    error_message TEXT,
    priority INT DEFAULT 0,
    cron VARCHAR(50),
    attempts INT NOT NULL DEFAULT 0,          -- Incremented on each claim; doubles as fencing token
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
