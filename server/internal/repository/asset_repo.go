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

func NewAssetRepository(db db.DBTX) *AssetRepository {
	return &AssetRepository{db: db}
}

func (r *AssetRepository) CreateAsset(ctx context.Context, asset *model.Asset) error {
	query := fmt.Sprintf(`
		INSERT INTO assets (file_hash, file_size, mime_type, extension, storage_path)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING %s
	`, assetSelectColumns)

	rows, err := r.db.Query(ctx, query,
		asset.FileHash, asset.FileSize, asset.MimeType, asset.Extension,
		asset.StoragePath,
	)
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

func (r *AssetRepository) GetAsset(ctx context.Context, id string) (*model.Asset, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM assets
		WHERE id = $1::uuid
	`, assetSelectColumns)

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

func (r *AssetRepository) GetAssetByHash(ctx context.Context, hash string) (*model.Asset, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM assets
		WHERE file_hash = $1
	`, assetSelectColumns)

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

func (r *AssetRepository) HasAssetAccess(ctx context.Context, assetID string, ownerID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM assets a
			LEFT JOIN nodes n ON a.id = n.asset_id AND n.owner_id = $2::uuid
			WHERE a.id = $1::uuid AND (a.public_ref_count > 0 OR n.id IS NOT NULL)
		)
	`
	var exists bool
	err := r.db.QueryRow(ctx, query, assetID, ownerID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check asset access: %w", err)
	}
	return exists, nil
}
