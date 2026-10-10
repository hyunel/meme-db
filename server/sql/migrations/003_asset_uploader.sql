-- Records who first uploaded each asset, for the admin user page.
-- Run once: psql "$DATABASE_URL" -f server/sql/migrations/003_asset_uploader.sql
BEGIN;

ALTER TABLE core.assets ADD COLUMN uploaded_by UUID REFERENCES iam.users(id) ON DELETE SET NULL;
CREATE INDEX idx_assets_uploader ON core.assets(uploaded_by, created_at);

-- Best guess for existing assets: the owner of their earliest library entry.
UPDATE core.assets a SET uploaded_by = (
    SELECT n.owner_id FROM library.nodes n WHERE n.asset_id = a.id ORDER BY n.created_at LIMIT 1
);

COMMIT;
