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

func NewTagRepository(db db.DBTX) *TagRepository {
	return &TagRepository{db: db}
}

func (r *TagRepository) GetAssetTags(ctx context.Context, assetID string, userID *string) ([]*model.Tag, error) {
	query := `
		SELECT t.id, t.name, t.created_at
		FROM tags t
		JOIN asset_tags at ON t.id = at.tag_id
		WHERE at.asset_id = $1::uuid
		AND (at.user_id IS NULL OR at.user_id = $2::uuid)
	`

	var uid interface{}
	if userID != nil {
		uid = *userID
	} else {
		// Use a dummy UUID that won't match any user if userID is nil,
		// but since we check for NULL, this works.
		uid = "00000000-0000-0000-0000-000000000000"
	}

	rows, err := r.db.Query(ctx, query, assetID, uid)
	if err != nil {
		return nil, fmt.Errorf("failed to get asset tags: %w", err)
	}
	defer rows.Close()

	tags := make([]*model.Tag, 0)
	for rows.Next() {
		var tag model.Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.CreatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, &tag)
	}
	return tags, nil
}

func (r *TagRepository) GetAssetsByTag(ctx context.Context, tagID string) ([]*model.Asset, error) {
	query := `
		SELECT a.id, a.file_hash, a.file_size, a.mime_type, a.extension, a.storage_path, a.ref_count, a.public_ref_count, a.created_at
		FROM assets a
		JOIN asset_tags at ON a.id = at.asset_id
		WHERE at.tag_id = $1::uuid
		AND a.public_ref_count > 0
	`
	rows, err := r.db.Query(ctx, query, tagID)
	if err != nil {
		return nil, fmt.Errorf("failed to get assets by tag: %w", err)
	}
	defer rows.Close()

	assets := make([]*model.Asset, 0)
	for rows.Next() {
		var asset model.Asset
		err := rows.Scan(
			&asset.ID, &asset.FileHash, &asset.FileSize, &asset.MimeType,
			&asset.Extension, &asset.StoragePath, &asset.RefCount,
			&asset.PublicRefCount, &asset.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		assets = append(assets, &asset)
	}
	return assets, nil
}
