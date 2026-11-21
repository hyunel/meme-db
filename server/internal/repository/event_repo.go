package repository

import (
	"context"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

type EventRepository struct{ db db.DBTX }

func (r *EventRepository) InsertUses(ctx context.Context, events []model.Event) error {
	if len(events) == 0 {
		return nil
	}
	sources, at := make([]string, len(events)), make([]time.Time, len(events))
	memes, folders := make([]*string, len(events)), make([]*string, len(events))
	for i, e := range events {
		sources[i], at[i], memes[i], folders[i] = e.Source, e.At, nullable(e.MemeID), nullable(e.FolderID)
	}
	_, err := r.db.Exec(ctx, `
	INSERT INTO core.events (kind, source, at, asset_id, node_id)
	SELECT 'use', e.source, e.at, e.asset_id, e.node_id
	FROM unnest($1::text[], $2::timestamptz[], $3::uuid[], $4::uuid[]) AS e(source, at, asset_id, node_id)
	WHERE e.at <= CURRENT_TIMESTAMP + INTERVAL '1 minute'
		AND (EXISTS (SELECT 1 FROM core.assets a WHERE a.id = e.asset_id)
			OR EXISTS (SELECT 1 FROM library.nodes n WHERE n.id = e.node_id AND n.type = 'FOLDER'))
`, sources, at, memes, folders)
	return err
}

func (r *EventRepository) Insert(ctx context.Context, viewerID string, admin bool, events []model.Event) error {
	if len(events) == 0 {
		return nil
	}
	kinds, at := make([]string, len(events)), make([]*time.Time, len(events))
	memes, folders, tokens := make([]*string, len(events)), make([]*string, len(events)), make([]*string, len(events))
	for i, e := range events {
		kinds[i], memes[i], folders[i], tokens[i] = e.Kind, nullable(e.MemeID), nullable(e.FolderID), nullable(e.Share)
		if !e.At.IsZero() {
			at[i] = &e.At
		}
	}
	query := `
	WITH targets AS (
		SELECT e.*,
			(m.asset_id IS NOT NULL AND ` + memeVisible("$6", "$7") + `)
			OR (n.type = 'FOLDER' AND (n.owner_id = $6::uuid OR (u.status = 'active'
				AND EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> n.path)))) AS visible,
			CASE WHEN su.status = 'active' AND ` + live + ` AND (
				s.asset_id = e.asset_id OR f.path @> n.path OR EXISTS (
					SELECT 1 FROM library.nodes c WHERE c.asset_id = e.asset_id
					AND c.owner_id = s.owner_id AND c.path <@ f.path
				)) THEN s.token END AS share
		FROM unnest($1::text[], $2::timestamptz[], $3::uuid[], $4::uuid[], $5::uuid[]) AS e(kind, at, asset_id, node_id, token)
		LEFT JOIN core.meme_info m ON m.asset_id = e.asset_id
		LEFT JOIN library.nodes n ON n.id = e.node_id AND n.type = 'FOLDER'
		LEFT JOIN iam.users u ON u.id = n.owner_id
		LEFT JOIN library.share_links s ON s.token = e.token
		LEFT JOIN iam.users su ON su.id = s.owner_id
		LEFT JOIN library.nodes f ON f.id = s.folder_id
	)
	INSERT INTO core.events (kind, at, user_id, asset_id, node_id, share_token)
	SELECT kind, COALESCE(at, CURRENT_TIMESTAMP), $6::uuid, asset_id, node_id, share
	FROM targets WHERE visible OR share IS NOT NULL
`
	_, err := r.db.Exec(ctx, query, kinds, at, memes, folders, tokens, nullable(viewerID), admin)
	return err
}
