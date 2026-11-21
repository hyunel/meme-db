-- Sources own public tags and report external uses.
CREATE TABLE IF NOT EXISTS core.sources (
    name VARCHAR(50) PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO core.sources (name) VALUES ('vlm');

-- A link belongs to a source or to a user, who alone change it; everyone sees a source's, only its user a user's.
ALTER TABLE library.asset_tags ADD COLUMN source VARCHAR(50) REFERENCES core.sources(name) ON DELETE CASCADE;
UPDATE library.asset_tags SET source = 'vlm' WHERE user_id IS NULL;
ALTER TABLE library.asset_tags
    ADD CONSTRAINT chk_asset_tags_owner CHECK (num_nonnulls(source, user_id) = 1),
    DROP CONSTRAINT asset_tags_asset_id_label_id_user_id_key,
    ADD CONSTRAINT asset_tags_owner_key UNIQUE NULLS NOT DISTINCT (asset_id, label_id, source, user_id);

CREATE INDEX IF NOT EXISTS idx_asset_tags_source ON library.asset_tags(source, asset_id) WHERE source IS NOT NULL;

-- Events and logs are partitioned by time.
CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE ops.logs DROP CONSTRAINT logs_pkey, ADD PRIMARY KEY (id, time);
SELECT create_hypertable('ops.logs', by_range('time'), migrate_data => true, create_default_indexes => false);

-- Events carry no foreign keys: the write checks its targets, and a deletion leaves the events behind.
CREATE TABLE core.events (
    at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind TEXT NOT NULL,
    source VARCHAR(50),
    user_id UUID,
    asset_id UUID,
    node_id UUID,
    share_token UUID,
    CHECK (num_nonnulls(asset_id, node_id) = 1),
    CHECK (
        (kind = 'use' AND source IS NOT NULL AND share_token IS NULL)
        OR (kind IN ('view', 'save') AND source IS NULL)
    )
) WITH (tsdb.hypertable, tsdb.partition_column = 'at', tsdb.chunk_interval = '1 day',
    tsdb.segmentby = 'source, kind', tsdb.orderby = 'asset_id, node_id, share_token, at');

CREATE INDEX idx_events_source ON core.events(source, at) WHERE source IS NOT NULL;

DROP TRIGGER trg_nodes_popularity ON library.nodes;
DROP TRIGGER trg_favorites_popularity ON library.favorites;
DROP FUNCTION library.count_popularity();
ALTER TABLE core.meme_stats
    DROP COLUMN popularity,
    ADD COLUMN uses BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN views BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN saves BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN day BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN week BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN month BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_meme_stats_day ON core.meme_stats(day DESC, asset_id DESC);
CREATE INDEX IF NOT EXISTS idx_meme_stats_week ON core.meme_stats(week DESC, asset_id DESC);
CREATE INDEX IF NOT EXISTS idx_meme_stats_month ON core.meme_stats(month DESC, asset_id DESC);

CREATE TABLE IF NOT EXISTS library.folder_stats (
    node_id UUID PRIMARY KEY REFERENCES library.nodes(id) ON DELETE CASCADE,
    uses BIGINT NOT NULL DEFAULT 0,
    views BIGINT NOT NULL DEFAULT 0,
    saves BIGINT NOT NULL DEFAULT 0,
    day BIGINT NOT NULL DEFAULT 0,
    week BIGINT NOT NULL DEFAULT 0,
    month BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_folder_stats_day ON library.folder_stats(day DESC, node_id DESC);
CREATE INDEX IF NOT EXISTS idx_folder_stats_week ON library.folder_stats(week DESC, node_id DESC);
CREATE INDEX IF NOT EXISTS idx_folder_stats_month ON library.folder_stats(month DESC, node_id DESC);

CREATE INDEX idx_meme_stats_active ON core.meme_stats(asset_id) WHERE day <> 0 OR week <> 0 OR month <> 0;
CREATE INDEX idx_folder_stats_active ON library.folder_stats(node_id) WHERE day <> 0 OR week <> 0 OR month <> 0;

INSERT INTO library.folder_stats (node_id) SELECT id FROM library.nodes WHERE type = 'FOLDER';

CREATE OR REPLACE FUNCTION library.add_folder_stats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO library.folder_stats (node_id) VALUES (NEW.id);
    RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER trg_folders_stats AFTER INSERT ON library.nodes
    FOR EACH ROW WHEN (NEW.type = 'FOLDER') EXECUTE FUNCTION library.add_folder_stats();

-- Events count as they arrive, so no writer has to know the tables they feed.
CREATE OR REPLACE FUNCTION core.count_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO core.meme_stats AS s (asset_id, uses, views, saves)
    SELECT asset_id, count(*) FILTER (WHERE kind = 'use'), count(*) FILTER (WHERE kind = 'view'),
        count(*) FILTER (WHERE kind = 'save')
    FROM inserted WHERE asset_id IS NOT NULL GROUP BY asset_id
    ON CONFLICT (asset_id) DO UPDATE SET uses = s.uses + EXCLUDED.uses,
        views = s.views + EXCLUDED.views, saves = s.saves + EXCLUDED.saves;

    INSERT INTO library.folder_stats AS s (node_id, uses, views, saves)
    SELECT node_id, count(*) FILTER (WHERE kind = 'use'), count(*) FILTER (WHERE kind = 'view'),
        count(*) FILTER (WHERE kind = 'save')
    FROM inserted WHERE node_id IS NOT NULL GROUP BY node_id
    ON CONFLICT (node_id) DO UPDATE SET uses = s.uses + EXCLUDED.uses,
        views = s.views + EXCLUDED.views, saves = s.saves + EXCLUDED.saves;

    -- A link counts what it opens for others; its owner's own views and saves don't count.
    UPDATE library.share_links l SET view_count = l.view_count + d.views, save_count = l.save_count + d.saves,
        last_viewed_at = GREATEST(l.last_viewed_at, d.last_viewed_at)
    FROM (
        SELECT i.share_token, count(*) FILTER (WHERE i.kind = 'view') AS views,
            count(*) FILTER (WHERE i.kind = 'save') AS saves,
            max(i.at) FILTER (WHERE i.kind = 'view') AS last_viewed_at
        FROM inserted i JOIN library.share_links s ON s.token = i.share_token
        WHERE i.user_id IS DISTINCT FROM s.owner_id
        GROUP BY i.share_token
    ) d
    WHERE l.token = d.share_token;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_events_count AFTER INSERT ON core.events
    REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION core.count_events();

-- Tag popularity is the sum of its public memes' scores.
DROP MATERIALIZED VIEW library.tag_usage;
CREATE MATERIALIZED VIEW library.tag_usage AS
WITH listed AS (
    SELECT pf.asset_id FROM library.public_files pf
    JOIN core.meme_info m ON m.asset_id = pf.asset_id
    WHERE m.analyzed_at IS NOT NULL
), tagged AS (
    SELECT l.tag_id, at.asset_id, bool_or(at.source IS NOT NULL) AND at.asset_id IN (SELECT asset_id FROM listed) AS public
    FROM library.asset_tags at
    JOIN library.labels l ON l.id = at.label_id
    GROUP BY 1, 2
)
SELECT t.tag_id, count(*) AS usage, count(*) FILTER (WHERE t.public) AS public_usage,
    COALESCE(sum(s.day) FILTER (WHERE t.public), 0) AS day,
    COALESCE(sum(s.week) FILTER (WHERE t.public), 0) AS week,
    COALESCE(sum(s.month) FILTER (WHERE t.public), 0) AS month
FROM tagged t
LEFT JOIN core.meme_stats s ON s.asset_id = t.asset_id
GROUP BY t.tag_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_usage ON library.tag_usage(tag_id); -- Lets it refresh concurrently
