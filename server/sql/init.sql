-- ============================================================================
-- EXTENSIONS & TYPES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TYPE node_type AS ENUM ('FOLDER', 'FILE');
CREATE TYPE visibility_status AS ENUM ('PRIVATE', 'PUBLIC', 'LINK');

-- ============================================================================
-- SCHEMAS
-- ============================================================================
-- core    : Core data (assets, meme analysis)
-- iam     : Identity & Access Management (users, roles, permissions)
-- library : User content (nodes, favorites, tags)
-- jobs    : Background task queue
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
    ref_count INT DEFAULT 0,                  -- Total nodes referencing this
    public_ref_count INT DEFAULT 0,           -- Nodes with PUBLIC visibility chain
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_hash ON core.assets(file_hash);
CREATE INDEX IF NOT EXISTS idx_assets_public ON core.assets(public_ref_count) WHERE public_ref_count > 0;

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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TABLES: Library
-- ============================================================================
CREATE TABLE IF NOT EXISTS library.nodes (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    owner_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES library.nodes(id) ON DELETE CASCADE,
    path ltree NOT NULL,                      -- Materialized path (no hyphens)
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    visibility visibility_status DEFAULT 'PRIVATE',
    asset_id UUID REFERENCES core.assets(id), -- NULL for folders
    private_note TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_path ON library.nodes USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_nodes_asset ON library.nodes(asset_id);
CREATE INDEX IF NOT EXISTS idx_nodes_asset_owner ON library.nodes(asset_id, owner_id);
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

CREATE INDEX IF NOT EXISTS idx_favorites_user ON library.favorites(user_id);
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

-- ============================================================================
-- FUNCTIONS
-- ============================================================================
-- Session context: Get current user ID from session variable
CREATE OR REPLACE FUNCTION public.current_app_user_id() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- Count PUBLIC ancestors for a given node path (used for public_ref_count)
CREATE OR REPLACE FUNCTION library.get_public_ancestor_count(node_path ltree) RETURNS INT AS $$
    SELECT count(*)::int
    FROM library.nodes
    WHERE node_path <@ path AND path != node_path AND visibility = 'PUBLIC';
$$ LANGUAGE sql STABLE;

-- Check if a node has any PUBLIC ancestor (used for RLS inherited visibility)
CREATE OR REPLACE FUNCTION library.has_public_ancestor(node_path ltree) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM library.nodes
        WHERE node_path <@ path AND path != node_path AND visibility = 'PUBLIC'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS: Reference Counting
-- ============================================================================
-- Maintains core.assets.ref_count and public_ref_count automatically.
CREATE OR REPLACE FUNCTION library.maintain_asset_refs() RETURNS TRIGGER AS $$
DECLARE
    delta_ref INT := 0;
    delta_public INT := 0;
    old_score INT := 0;
    new_score INT := 0;
BEGIN
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.asset_id IS NOT NULL THEN
        delta_ref := delta_ref - 1;
        IF TG_OP = 'DELETE' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            old_score := (CASE WHEN OLD.visibility = 'PUBLIC' THEN 1 ELSE 0 END)
                       + library.get_public_ancestor_count(OLD.path);
            delta_public := delta_public - old_score;
        END IF;

        IF TG_OP = 'UPDATE' AND OLD.asset_id IS DISTINCT FROM NEW.asset_id THEN
            UPDATE core.assets SET ref_count = ref_count - 1, public_ref_count = public_ref_count - old_score
            WHERE id = OLD.asset_id;
            delta_ref := 0;
            delta_public := 0;
        END IF;
    END IF;

    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.asset_id IS NOT NULL THEN
        delta_ref := delta_ref + 1;
        IF TG_OP = 'INSERT' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            new_score := (CASE WHEN NEW.visibility = 'PUBLIC' THEN 1 ELSE 0 END)
                       + library.get_public_ancestor_count(NEW.path);
            delta_public := delta_public + new_score;
        END IF;
    END IF;

    IF delta_ref != 0 OR delta_public != 0 THEN
        UPDATE core.assets SET ref_count = ref_count + delta_ref, public_ref_count = public_ref_count + delta_public
        WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.asset_id ELSE NEW.asset_id END);
    END IF;

    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.type = 'FOLDER' AND OLD.visibility = 'PUBLIC' THEN
        IF TG_OP = 'DELETE' OR NEW.visibility != 'PUBLIC' THEN
            UPDATE core.assets a SET public_ref_count = public_ref_count - sub.count
            FROM (SELECT asset_id, count(*) as count FROM library.nodes
                  WHERE path <@ OLD.path AND id != OLD.id AND type = 'FILE' AND asset_id IS NOT NULL
                  GROUP BY asset_id) sub
            WHERE a.id = sub.asset_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.type = 'FOLDER' AND NEW.visibility = 'PUBLIC' AND OLD.visibility != 'PUBLIC' THEN
        UPDATE core.assets a SET public_ref_count = public_ref_count + sub.count
        FROM (SELECT asset_id, count(*) as count FROM library.nodes
              WHERE path <@ NEW.path AND id != NEW.id AND type = 'FILE' AND asset_id IS NOT NULL
              GROUP BY asset_id) sub
        WHERE a.id = sub.asset_id;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_maintain_refs
    BEFORE INSERT OR UPDATE OR DELETE ON library.nodes
    FOR EACH ROW EXECUTE FUNCTION library.maintain_asset_refs();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Uses session variable `app.current_user_id` for automatic row filtering.
ALTER TABLE library.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.asset_tags ENABLE ROW LEVEL SECURITY;

-- Nodes: Owner access + PUBLIC nodes + inherited PUBLIC from ancestors
CREATE POLICY nodes_owner_policy ON library.nodes FOR ALL
    USING (
        owner_id = current_app_user_id()
        OR visibility = 'PUBLIC'
        OR library.has_public_ancestor(path)
    )
    WITH CHECK (owner_id = current_app_user_id());

-- Favorites: Owner access only
CREATE POLICY favorites_owner_policy ON library.favorites FOR ALL
    USING (user_id = current_app_user_id())
    WITH CHECK (user_id = current_app_user_id());

-- Asset Tags: System tags (user_id IS NULL) visible to all, user tags owner-only
CREATE POLICY asset_tags_owner_policy ON library.asset_tags FOR ALL
    USING (user_id IS NULL OR user_id = current_app_user_id())
    WITH CHECK (user_id IS NULL OR user_id = current_app_user_id());

-- ============================================================================
-- VIEWS
-- ============================================================================
-- Assets accessible to current user: public assets OR assets in user's library
CREATE OR REPLACE VIEW core.accessible_assets AS
SELECT DISTINCT a.*
FROM core.assets a
LEFT JOIN library.nodes n ON a.id = n.asset_id
WHERE a.public_ref_count > 0 OR n.id IS NOT NULL;

-- Meme view with processing status and library membership
CREATE OR REPLACE VIEW core.meme_view AS
SELECT
    a.id as asset_id,
    a.file_size,
    a.mime_type,
    a.extension,
    a.created_at,
    COALESCE(mi.width, 0) as width,
    COALESCE(mi.height, 0) as height,
    mi.analyzed_at,
    mi.vlm_json,
    mi.ocr_text,
    mi.metaphor_vector,
    mi.semantic_vector,
    mi.clip_vector,
    COALESCE(mi.processing_status, 'pending') as processing_status,
    EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = a.id) as in_library
FROM core.accessible_assets a
LEFT JOIN core.meme_info mi ON a.id = mi.asset_id;
