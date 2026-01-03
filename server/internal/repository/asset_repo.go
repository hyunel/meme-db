package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

const assetSelectColumns = `id, file_hash, file_size, mime_type, extension, storage_path, ref_count, public_ref_count, created_at`

type AssetRepository struct {
	db db.DBTX
}

func (r *AssetRepository) Create(ctx context.Context, asset *model.Asset) error {
	query := fmt.Sprintf(`
		INSERT INTO core.assets (file_hash, file_size, mime_type, extension, storage_path)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING %s
	`, assetSelectColumns)

	rows, err := r.db.Query(ctx, query, asset.FileHash, asset.FileSize, asset.MimeType, asset.Extension, asset.StoragePath)
	if err != nil {
		return fmt.Errorf("failed to create asset: %w", err)
	}
	newAsset, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Asset])
	if err != nil {
		return fmt.Errorf("failed to scan created asset: %w", err)
	}
	*asset = newAsset
	return nil
}

func (r *AssetRepository) Get(ctx context.Context, id string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE id = $1::uuid`, assetSelectColumns)
	rows, err := r.db.Query(ctx, query, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}
	asset, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Asset])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to collect asset: %w", err)
	}
	return &asset, nil
}

func (r *AssetRepository) GetByHash(ctx context.Context, hash string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE file_hash = $1`, assetSelectColumns)
	rows, err := r.db.Query(ctx, query, hash)
	if err != nil {
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}
	asset, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Asset])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to collect asset by hash: %w", err)
	}
	return &asset, nil
}

// HasAccess checks if current user (via RLS) can access the asset.
// Uses accessible_assets view which handles access control.
func (r *AssetRepository) HasAccess(ctx context.Context, assetID string) (bool, error) {
	query := `SELECT EXISTS (SELECT 1 FROM core.accessible_assets WHERE id = $1::uuid)`
	var exists bool
	err := r.db.QueryRow(ctx, query, assetID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check asset access: %w", err)
	}
	return exists, nil
}
