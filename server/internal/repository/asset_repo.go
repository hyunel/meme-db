package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

type AssetRepository struct {
	db db.DBTX
}

func NewAssetRepository(db db.DBTX) *AssetRepository {
	return &AssetRepository{db: db}
}

func (r *AssetRepository) CreateAsset(ctx context.Context, asset *model.Asset) error {
	query := `
		INSERT INTO assets (file_hash, file_size, mime_type, extension, storage_path)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`
	err := r.db.QueryRow(ctx, query,
		asset.FileHash, asset.FileSize, asset.MimeType, asset.Extension,
		asset.StoragePath,
	).Scan(&asset.ID, &asset.CreatedAt)

	if err != nil {
		return fmt.Errorf("failed to create asset: %w", err)
	}
	return nil
}

func (r *AssetRepository) GetAsset(ctx context.Context, id string) (*model.Asset, error) {
	query := `
		SELECT id, file_hash, file_size, mime_type, extension, storage_path, ref_count, public_ref_count, created_at
		FROM assets
		WHERE id = $1::uuid
	`
	var asset model.Asset
	err := r.db.QueryRow(ctx, query, id).Scan(
		&asset.ID, &asset.FileHash, &asset.FileSize, &asset.MimeType, &asset.Extension,
		&asset.StoragePath, &asset.RefCount, &asset.PublicRefCount, &asset.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}
	return &asset, nil
}

func (r *AssetRepository) GetAssetByHash(ctx context.Context, hash string) (*model.Asset, error) {
	query := `
		SELECT id, file_hash, file_size, mime_type, extension, storage_path, ref_count, public_ref_count, created_at
		FROM assets
		WHERE file_hash = $1
	`
	var asset model.Asset
	err := r.db.QueryRow(ctx, query, hash).Scan(
		&asset.ID, &asset.FileHash, &asset.FileSize, &asset.MimeType, &asset.Extension,
		&asset.StoragePath, &asset.RefCount, &asset.PublicRefCount, &asset.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}
	return &asset, nil
}
