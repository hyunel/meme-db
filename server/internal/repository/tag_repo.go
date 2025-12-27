package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

const tagSelectColumns = `t.id, t.name, t.created_at`

type TagRepository struct {
	db db.DBTX
}

func NewTagRepository(db db.DBTX) *TagRepository {
	return &TagRepository{db: db}
}

// ==============================================================================
// Query Operations
// ==============================================================================

func (r *TagRepository) GetAssetTags(ctx context.Context, assetID string, userID *string) ([]*model.Tag, error) {
	query := `
		SELECT t.id, t.name, t.created_at,
		       CASE WHEN at.user_id IS NULL THEN 'SYSTEM' ELSE 'USER' END as type
		FROM tags t
		JOIN asset_tags at ON t.id = at.tag_id
		WHERE at.asset_id = $1::uuid
		AND (at.user_id IS NULL OR at.user_id = $2::uuid)
	`

	rows, err := r.db.Query(ctx, query, assetID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get asset tags: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[model.Tag])
}

func (r *TagRepository) GetTagsByAssets(ctx context.Context, assetIDs []string, userID *string) (map[string][]*model.Tag, error) {
	if len(assetIDs) == 0 {
		return make(map[string][]*model.Tag), nil
	}

	query := fmt.Sprintf(`
		SELECT at.asset_id, %s,
		       CASE WHEN at.user_id IS NULL THEN 'SYSTEM' ELSE 'USER' END as type
		FROM asset_tags at
		JOIN tags t ON at.tag_id = t.id
		WHERE at.asset_id = ANY($1::uuid[])
		AND (at.user_id IS NULL OR at.user_id = $2::uuid)
	`, tagSelectColumns)

	rows, err := r.db.Query(ctx, query, assetIDs, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get tags by assets: %w", err)
	}

	type assetTagRow struct {
		AssetID string `db:"asset_id"`
		model.Tag
	}

	tagRows, err := pgx.CollectRows(rows, pgx.RowToStructByNameLax[assetTagRow])
	if err != nil {
		return nil, fmt.Errorf("failed to collect tag rows: %w", err)
	}

	result := make(map[string][]*model.Tag)
	for _, row := range tagRows {
		t := row.Tag
		result[row.AssetID] = append(result[row.AssetID], &t)
	}
	return result, nil
}

func (r *TagRepository) GetAssetsByTag(ctx context.Context, tagID string) ([]*model.Asset, error) {
	query := `
		SELECT a.id, a.file_hash, a.file_size, a.mime_type, a.extension, a.storage_path, a.ref_count, a.public_ref_count, a.created_at
		FROM assets a
		JOIN asset_tags at ON a.id = at.asset_id
		WHERE at.tag_id = $1::uuid
	`
	rows, err := r.db.Query(ctx, query, tagID)
	if err != nil {
		return nil, fmt.Errorf("failed to get assets by tag: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[model.Asset])
}

func (r *TagRepository) SearchTags(ctx context.Context, query string) ([]*model.Tag, error) {
	sql := `
		SELECT id, name, created_at, 'GLOBAL' as type
		FROM tags
		WHERE name ILIKE $1
		ORDER BY name ASC
		LIMIT 20
	`
	rows, err := r.db.Query(ctx, sql, "%"+query+"%")
	if err != nil {
		return nil, fmt.Errorf("failed to search tags: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[model.Tag])
}

func (r *TagRepository) GetTag(ctx context.Context, tagID string) (*model.Tag, error) {
	query := `
		SELECT id, name, created_at, 'GLOBAL' as type
		FROM tags
		WHERE id = $1::uuid
	`
	var t model.Tag
	err := r.db.QueryRow(ctx, query, tagID).Scan(&t.ID, &t.Name, &t.CreatedAt, &t.Type)
	if err != nil {
		return nil, fmt.Errorf("failed to get tag: %w", err)
	}
	return &t, nil
}

// ==============================================================================
// Management Operations
// ==============================================================================

func (r *TagRepository) CreateTag(ctx context.Context, name string) (*model.Tag, error) {
	query := `
		INSERT INTO tags (name)
		VALUES ($1)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id, name, created_at
	`
	var t model.Tag
	err := r.db.QueryRow(ctx, query, name).Scan(&t.ID, &t.Name, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create/get tag: %w", err)
	}
	return &t, nil
}

func (r *TagRepository) AddAssetTag(ctx context.Context, assetID, tagID string, userID *string) error {
	query := `
		INSERT INTO asset_tags (asset_id, tag_id, user_id)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, assetID, tagID, userID)
	if err != nil {
		return fmt.Errorf("failed to add asset tag: %w", err)
	}
	return nil
}

func (r *TagRepository) RemoveAssetTag(ctx context.Context, assetID, tagID string, userID *string) error {
	query := `
		DELETE FROM asset_tags
		WHERE asset_id = $1::uuid AND tag_id = $2::uuid AND user_id = $3::uuid
	`
	_, err := r.db.Exec(ctx, query, assetID, tagID, userID)
	if err != nil {
		return fmt.Errorf("failed to remove asset tag: %w", err)
	}
	return nil
}
