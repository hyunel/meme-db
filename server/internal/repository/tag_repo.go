package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

type TagRepository struct {
	db db.DBTX
}

// Upsert returns the tag named name, creating it if needed.
func (r *TagRepository) Upsert(ctx context.Context, name string) (*model.Tag, error) {
	query := `
		INSERT INTO library.tags (name) VALUES ($1)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id, name, created_at
	`
	return collectOne[model.Tag](r.db.Query(ctx, query, name))
}

// AddUserTag attaches a tag to an asset on behalf of userID.
func (r *TagRepository) AddUserTag(ctx context.Context, assetID, tagID, userID string) error {
	query := `
		INSERT INTO library.asset_tags (asset_id, tag_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, assetID, tagID, userID)
	return err
}

// RemoveUserTag detaches one of userID's tags from an asset.
func (r *TagRepository) RemoveUserTag(ctx context.Context, assetID, tagID, userID string) error {
	query := `DELETE FROM library.asset_tags WHERE asset_id = $1::uuid AND tag_id = $2::uuid AND user_id = $3::uuid`
	_, err := r.db.Exec(ctx, query, assetID, tagID, userID)
	return err
}

// SetSystemTags replaces the system tags of an asset; names must be distinct.
func (r *TagRepository) SetSystemTags(ctx context.Context, assetID string, names []string) error {
	if _, err := r.db.Exec(ctx, `DELETE FROM library.asset_tags WHERE asset_id = $1::uuid AND user_id IS NULL`, assetID); err != nil {
		return err
	}
	query := `
		WITH t AS (
			INSERT INTO library.tags (name) SELECT unnest($2::text[])
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		)
		INSERT INTO library.asset_tags (asset_id, tag_id) SELECT $1::uuid, id FROM t
	`
	_, err := r.db.Exec(ctx, query, assetID, names)
	return err
}

// Hot returns the system tags used most on the memes viewerID may see.
func (r *TagRepository) Hot(ctx context.Context, viewerID string, admin bool, limit int) ([]string, error) {
	var w filter
	w.where("at.user_id IS NULL")
	w.where(memeListed(&w, viewerID, admin))
	query := fmt.Sprintf(`
		SELECT t.name FROM library.asset_tags at
		JOIN library.tags t ON t.id = at.tag_id
		JOIN core.meme_info m ON m.asset_id = at.asset_id
		%s
		GROUP BY t.name ORDER BY count(*) DESC, t.name LIMIT %d
	`, w.clause(), limit)
	return collectScalars[string](r.db.Query(ctx, query, w.args...))
}

// ==============================================================================
// Administration
// ==============================================================================

// List lists tags whose name contains query, with how many memes use them.
func (r *TagRepository) List(ctx context.Context, query, sort string, page Page) ([]*model.TagUsage, int, error) {
	var w filter
	if query != "" {
		w.where("t.name ILIKE " + w.arg("%"+query+"%"))
	}
	total, err := count(ctx, r.db, "SELECT count(*) FROM library.tags t "+w.clause(), w.args...)
	if err != nil {
		return nil, 0, err
	}

	order := map[string]string{"name": "t.name", "created": "t.created_at DESC"}[sort]
	if order == "" {
		order = "usage DESC, t.name"
	}
	sql := fmt.Sprintf(`
		SELECT t.id, t.name, t.created_at, (SELECT count(*) FROM library.asset_tags at WHERE at.tag_id = t.id) AS usage
		FROM library.tags t %s ORDER BY %s %s
	`, w.clause(), order, page.clause())
	tags, err := collectAll[model.TagUsage](r.db.Query(ctx, sql, w.args...))
	return tags, total, err
}

func (r *TagRepository) Rename(ctx context.Context, id, name string) error {
	_, err := r.db.Exec(ctx, `UPDATE library.tags SET name = $2 WHERE id = $1::uuid`, id, name)
	return err
}

// Merge moves every use of the source tags onto the target and deletes the sources.
func (r *TagRepository) Merge(ctx context.Context, sourceIDs []string, targetID string) error {
	query := `
		INSERT INTO library.asset_tags (asset_id, tag_id, user_id)
		SELECT asset_id, $2::uuid, user_id FROM library.asset_tags WHERE tag_id = ANY($1::uuid[])
		ON CONFLICT DO NOTHING
	`
	if _, err := r.db.Exec(ctx, query, sourceIDs, targetID); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `DELETE FROM library.tags WHERE id = ANY($1::uuid[]) AND id <> $2::uuid`, sourceIDs, targetID)
	return err
}

func (r *TagRepository) Delete(ctx context.Context, ids []string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.tags WHERE id = ANY($1::uuid[])`, ids)
	return err
}
