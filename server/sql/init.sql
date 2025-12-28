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

    processing_status VARCHAR(20) DEFAULT 'pending',
    analyzed_at TIMESTAMPTZ
);

-- Partial index for pending analysis
CREATE INDEX IF NOT EXISTS idx_meme_pending_analysis ON meme_info (asset_id) WHERE processing_status = 'pending';

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
    private_note TEXT,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Fast Recursive Queries (Get all descendants)
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes USING GIST (path);
-- Fast Reverse Lookup (Asset -> User/Location)
CREATE INDEX IF NOT EXISTS idx_nodes_asset ON nodes(asset_id);
CREATE INDEX IF NOT EXISTS idx_nodes_asset_owner ON nodes(asset_id, owner_id);
-- Fast List Directory
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- ==============================================================================
-- 5. USER FAVORITES
-- ==============================================================================
-- Unified table for favoriting both Memes (Assets) and Folders (Nodes)
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Target: Either an Asset (Meme) or a Node (Folder)
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- Constraint: Must target exactly one type
    CONSTRAINT chk_favorite_target CHECK (
        (asset_id IS NOT NULL AND node_id IS NULL) OR
        (asset_id IS NULL AND node_id IS NOT NULL)
    ),

    -- Constraint: Uniqueness (User cannot favorite same item twice)
    -- utilizing NULLS NOT DISTINCT capability if available
    UNIQUE NULLS NOT DISTINCT (user_id, asset_id, node_id)
);

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_asset ON favorites(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_favorites_node ON favorites(node_id) WHERE node_id IS NOT NULL;

-- ==============================================================================
-- 6. TAG MANAGEMENT
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
-- 7. REFERENCE COUNTING TRIGGERS
-- ==============================================================================

-- Helper to count public nodes in a path (excluding the node itself)
CREATE OR REPLACE FUNCTION get_public_ancestor_count(node_path ltree) RETURNS INT AS $$
    SELECT count(*)::int
    FROM nodes
    WHERE node_path <@ path AND path != node_path AND visibility = 'PUBLIC';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION maintain_asset_refs() RETURNS TRIGGER AS $$
DECLARE
    delta_ref INT := 0;
    delta_public INT := 0;
    old_score INT := 0;
    new_score INT := 0;
BEGIN
    -- 1. Handle File-level Changes (Ref Count & Public Ref Count)
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.asset_id IS NOT NULL THEN
        delta_ref := delta_ref - 1;
        -- Calculate Old Score (Self + Ancestors)
        IF TG_OP = 'DELETE' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            old_score := (CASE WHEN OLD.visibility = 'PUBLIC' THEN 1 ELSE 0 END) + get_public_ancestor_count(OLD.path);
            delta_public := delta_public - old_score;
        END IF;

        -- Apply to Old Asset if AssetID changed
        IF TG_OP = 'UPDATE' AND OLD.asset_id IS DISTINCT FROM NEW.asset_id THEN
             UPDATE assets SET ref_count = ref_count - 1, public_ref_count = public_ref_count - old_score WHERE id = OLD.asset_id;
             delta_ref := 0; delta_public := 0; -- Reset for New Asset
        END IF;
    END IF;

    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.asset_id IS NOT NULL THEN
        delta_ref := delta_ref + 1;
        -- Calculate New Score
        IF TG_OP = 'INSERT' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            new_score := (CASE WHEN NEW.visibility = 'PUBLIC' THEN 1 ELSE 0 END) + get_public_ancestor_count(NEW.path);
            delta_public := delta_public + new_score;
        END IF;
    END IF;

    -- Apply remaining deltas
    IF delta_ref != 0 OR delta_public != 0 THEN
        UPDATE assets SET ref_count = ref_count + delta_ref, public_ref_count = public_ref_count + delta_public
        WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.asset_id ELSE NEW.asset_id END);
    END IF;

    -- 2. Handle Folder Visibility Propagation
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.type = 'FOLDER' AND OLD.visibility = 'PUBLIC' THEN
        IF TG_OP = 'DELETE' OR NEW.visibility != 'PUBLIC' THEN
            UPDATE assets a SET public_ref_count = public_ref_count - sub.count
            FROM (SELECT asset_id, count(*) as count FROM nodes WHERE path <@ OLD.path AND id != OLD.id AND type = 'FILE' AND asset_id IS NOT NULL GROUP BY asset_id) sub
            WHERE a.id = sub.asset_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.type = 'FOLDER' AND NEW.visibility = 'PUBLIC' AND OLD.visibility != 'PUBLIC' THEN
        UPDATE assets a SET public_ref_count = public_ref_count + sub.count
        FROM (SELECT asset_id, count(*) as count FROM nodes WHERE path <@ NEW.path AND id != NEW.id AND type = 'FILE' AND asset_id IS NOT NULL GROUP BY asset_id) sub
        WHERE a.id = sub.asset_id;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_maintain_refs
BEFORE INSERT OR UPDATE OR DELETE ON nodes
FOR EACH ROW EXECUTE FUNCTION maintain_asset_refs();

-- ==============================================================================
-- 8. TASK QUEUE
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
