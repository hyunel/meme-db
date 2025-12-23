CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

-- ==============================================================================
-- 1. ASSET STORAGE (Deduplicated Physical Files)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuidv7(),

    -- Physical Deduplication
    file_hash CHAR(64) UNIQUE NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    extension VARCHAR(10) NOT NULL,

    storage_path VARCHAR(255) NOT NULL,

    -- Reference Counting
    ref_count INT DEFAULT 0,         -- Total nodes referencing this asset
    public_ref_count INT DEFAULT 0,  -- Total PUBLIC nodes referencing this asset

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(file_hash);
CREATE INDEX IF NOT EXISTS idx_assets_public ON assets(public_ref_count) WHERE public_ref_count > 0;

-- ==============================================================================
-- 2. MEME INTELLIGENCE (AI & Metadata)
-- ==============================================================================
-- 1:1 Relationship with Assets. Stores system-generated knowledge.
CREATE TABLE IF NOT EXISTS meme_info (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,

    -- AI Analysis Results
    vlm_json JSONB,             -- Full VLM output
    ocr_text TEXT,              -- Extracted text for FTS

    -- Vector Embeddings
    metaphor_vector vector(1024),
    semantic_vector vector(1024),
    clip_vector vector(768),

    -- Image Specs
    width INT,
    height INT,

    analyzed_at TIMESTAMPTZ
);

-- Partial index for pending analysis
CREATE INDEX IF NOT EXISTS idx_meme_pending_analysis ON meme_info (asset_id) WHERE analyzed_at IS NULL;

-- Vector Indexes (HNSW)
CREATE INDEX IF NOT EXISTS idx_meme_sem ON meme_info USING hnsw (semantic_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_meme_meta ON meme_info USING hnsw (metaphor_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_meme_clip ON meme_info USING hnsw (clip_vector vector_cosine_ops);
-- Text Search Index
CREATE INDEX IF NOT EXISTS idx_meme_ocr ON meme_info USING GIN (ocr_text gin_trgm_ops);

-- ==============================================================================
-- 3. USER MANAGEMENT
-- ==============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 4. FILE SYSTEM (Nodes) - The Core Hierarchy
-- ==============================================================================
CREATE TYPE node_type AS ENUM ('FOLDER', 'FILE');
CREATE TYPE visibility_status AS ENUM ('PRIVATE', 'PUBLIC', 'LINK');

CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT uuidv7(),

    -- Ownership
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Hierarchy (Adjacency + Path Enumeration)
    parent_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    path ltree NOT NULL,  -- Format: "root_uuid.folder_uuid.node_uuid" (hyphens removed)

    -- Node Properties
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    visibility visibility_status DEFAULT 'PRIVATE',

    -- Content (Nullable for Folders)
    asset_id UUID REFERENCES assets(id),

    -- User Metadata
    is_favorite BOOLEAN DEFAULT FALSE,
    private_note TEXT,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Constraint: Unique names within a folder for a user
-- Note: Empty names are allowed to be non-unique (to support unnamed uploads)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_unique_name_per_folder
ON nodes (owner_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'), name)
WHERE name <> '';

-- Fast Recursive Queries (Get all descendants)
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes USING GIST (path);
-- Fast Reverse Lookup (Asset -> User/Location)
CREATE INDEX IF NOT EXISTS idx_nodes_asset ON nodes(asset_id);
CREATE INDEX IF NOT EXISTS idx_nodes_asset_owner ON nodes(asset_id, owner_id);
-- Fast List Directory
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- ==============================================================================
-- 5. TAG MANAGEMENT
-- ==============================================================================
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Consolidated Tag Association
-- Links tags to assets. Can be SYSTEM (global, user_id is NULL) or USER (private to user).
CREATE TABLE IF NOT EXISTS asset_tags (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL for SYSTEM tags

    UNIQUE NULLS NOT DISTINCT (asset_id, tag_id, user_id)
);

-- Index for querying tags of an asset (System tags + specific User tags)
CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_user ON asset_tags (asset_id, user_id);
-- Index for finding all assets associated with a tag
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags (tag_id);

-- ==============================================================================
-- 6. REFERENCE COUNTING TRIGGERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION maintain_asset_refs() RETURNS TRIGGER AS $$
BEGIN
    -- Handle Insert
    IF (TG_OP = 'INSERT') THEN
        IF NEW.asset_id IS NOT NULL THEN
            UPDATE assets SET ref_count = ref_count + 1 WHERE id = NEW.asset_id;
            IF NEW.visibility = 'PUBLIC' THEN
                UPDATE assets SET public_ref_count = public_ref_count + 1 WHERE id = NEW.asset_id;
            END IF;
        END IF;
        RETURN NEW;

    -- Handle Delete
    ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.asset_id IS NOT NULL THEN
            UPDATE assets SET ref_count = ref_count - 1 WHERE id = OLD.asset_id;
            IF OLD.visibility = 'PUBLIC' THEN
                UPDATE assets SET public_ref_count = public_ref_count - 1 WHERE id = OLD.asset_id;
            END IF;
        END IF;
        RETURN OLD;

    -- Handle Update
    ELSIF (TG_OP = 'UPDATE') THEN
        -- If asset_id changed (unlikely for files, but possible)
        IF OLD.asset_id IS DISTINCT FROM NEW.asset_id THEN
            -- Decrement Old
            IF OLD.asset_id IS NOT NULL THEN
                UPDATE assets SET ref_count = ref_count - 1 WHERE id = OLD.asset_id;
                IF OLD.visibility = 'PUBLIC' THEN
                    UPDATE assets SET public_ref_count = public_ref_count - 1 WHERE id = OLD.asset_id;
                END IF;
            END IF;
            -- Increment New
            IF NEW.asset_id IS NOT NULL THEN
                UPDATE assets SET ref_count = ref_count + 1 WHERE id = NEW.asset_id;
                IF NEW.visibility = 'PUBLIC' THEN
                    UPDATE assets SET public_ref_count = public_ref_count + 1 WHERE id = NEW.asset_id;
                END IF;
            END IF;
        ELSE
            -- Asset ID same, but Visibility changed
            IF OLD.visibility IS DISTINCT FROM NEW.visibility AND NEW.asset_id IS NOT NULL THEN
                IF NEW.visibility = 'PUBLIC' THEN
                    UPDATE assets SET public_ref_count = public_ref_count + 1 WHERE id = NEW.asset_id;
                ELSIF OLD.visibility = 'PUBLIC' THEN
                    UPDATE assets SET public_ref_count = public_ref_count - 1 WHERE id = NEW.asset_id;
                END IF;
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maintain_refs
AFTER INSERT OR UPDATE OR DELETE ON nodes
FOR EACH ROW EXECUTE FUNCTION maintain_asset_refs();

-- ==============================================================================
-- 7. TASK QUEUE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID DEFAULT uuidv7(),

    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_task_id UUID,
    job_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,

    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    priority INT DEFAULT 0,
    cron VARCHAR(50),

    run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,

    context JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, status)
) PARTITION BY LIST (status);

-- Partitions for Active and Historical Tasks
CREATE TABLE IF NOT EXISTS tasks_active PARTITION OF tasks FOR VALUES IN ('pending');
CREATE TABLE IF NOT EXISTS tasks_history PARTITION OF tasks FOR VALUES IN ('completed', 'failed');

CREATE INDEX IF NOT EXISTS idx_tasks_active_queue ON tasks_active(priority DESC, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_history_created ON tasks_history(created_at);
