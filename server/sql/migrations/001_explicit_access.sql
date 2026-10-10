-- Upgrades a database created by the previous init.sql to the current schema.
-- Run once: psql "$DATABASE_URL" -f server/sql/migrations/001_explicit_access.sql
BEGIN;

-- Access control moves from RLS (bypassed by the superuser connection) into the application.
DROP VIEW IF EXISTS core.meme_view;
DROP VIEW IF EXISTS core.accessible_assets;
DROP POLICY IF EXISTS nodes_owner_policy ON library.nodes;
DROP POLICY IF EXISTS favorites_owner_policy ON library.favorites;
DROP POLICY IF EXISTS asset_tags_owner_policy ON library.asset_tags;
ALTER TABLE library.nodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE library.favorites DISABLE ROW LEVEL SECURITY;
ALTER TABLE library.asset_tags DISABLE ROW LEVEL SECURITY;

-- Public visibility is derived from the tree at query time instead of trigger-maintained counters.
DROP TRIGGER IF EXISTS trg_maintain_refs ON library.nodes;
DROP FUNCTION IF EXISTS library.maintain_asset_refs();
DROP FUNCTION IF EXISTS library.get_public_ancestor_count(ltree);
DROP FUNCTION IF EXISTS library.has_public_ancestor(ltree);
DROP FUNCTION IF EXISTS public.current_app_user_id();
DROP INDEX IF EXISTS core.idx_assets_public;
DROP INDEX IF EXISTS core.idx_assets_hash;
ALTER TABLE core.assets DROP COLUMN ref_count, DROP COLUMN public_ref_count;
CREATE INDEX idx_assets_created ON core.assets(created_at);

ALTER TABLE core.meme_info ADD COLUMN fail_reason TEXT;
ALTER TABLE iam.users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE library.nodes ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
UPDATE library.nodes SET is_public = (visibility = 'PUBLIC');
ALTER TABLE library.nodes DROP COLUMN visibility, DROP COLUMN private_note;
DROP TYPE visibility_status;
ALTER TABLE library.nodes DROP CONSTRAINT nodes_asset_id_fkey,
    ADD CONSTRAINT nodes_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES core.assets(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS library.idx_nodes_asset;
DROP INDEX IF EXISTS library.idx_favorites_user;
CREATE INDEX idx_nodes_public_path ON library.nodes USING GIST (path) WHERE is_public;
CREATE INDEX idx_nodes_owner_parent ON library.nodes(owner_id, parent_id);

CREATE VIEW library.public_files AS
SELECT n.* FROM library.nodes n
JOIN iam.users u ON u.id = n.owner_id AND u.status = 'active'
WHERE n.type = 'FILE'
  AND EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> n.path);

CREATE INDEX idx_tasks_asset ON jobs.tasks ((payload->>'asset_id'));

-- System tags are now derived from the analysis; backfill them for analyzed memes.
INSERT INTO library.tags (name)
SELECT DISTINCT left(trim(t), 100)
FROM core.meme_info mi,
     jsonb_array_elements_text(COALESCE(mi.vlm_json->'specific_entities', '[]') || COALESCE(mi.vlm_json->'visual_style', '[]')) t
WHERE mi.processing_status = 'success' AND jsonb_typeof(mi.vlm_json->'visual_style') = 'array' AND trim(t) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO library.asset_tags (asset_id, tag_id)
SELECT DISTINCT mi.asset_id, tg.id
FROM core.meme_info mi,
     jsonb_array_elements_text(COALESCE(mi.vlm_json->'specific_entities', '[]') || COALESCE(mi.vlm_json->'visual_style', '[]')) t
JOIN library.tags tg ON tg.name = left(trim(t), 100)
WHERE mi.processing_status = 'success' AND jsonb_typeof(mi.vlm_json->'visual_style') = 'array'
ON CONFLICT DO NOTHING;

COMMIT;
