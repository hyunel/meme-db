package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const assetSelectColumns = `id, file_hash, file_size, mime_type, extension, storage_path, created_at`

type AssetRepository struct {
	db db.DBTX
}

// Create inserts an asset unless one with the same hash exists, and returns the stored
// asset with whether it was newly created.
func (r *AssetRepository) Create(ctx context.Context, asset *model.Asset) (*model.Asset, bool, error) {
	query := fmt.Sprintf(`
		INSERT INTO core.assets (file_hash, file_size, mime_type, extension, storage_path)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (file_hash) DO NOTHING
		RETURNING %s
	`, assetSelectColumns)
	created, err := collectOne[model.Asset](r.db.Query(ctx, query, asset.FileHash, asset.FileSize, asset.MimeType, asset.Extension, asset.StoragePath))
	if err != nil || created != nil {
		return created, created != nil, err
	}
	existing, err := r.GetByHash(ctx, asset.FileHash)
	return existing, false, err
}

// Get returns an asset by ID, or nil if it does not exist.
func (r *AssetRepository) Get(ctx context.Context, id string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE id = $1::uuid`, assetSelectColumns)
	return collectOne[model.Asset](r.db.Query(ctx, query, id))
}

// GetByHash returns an asset by content hash, or nil if it does not exist.
func (r *AssetRepository) GetByHash(ctx context.Context, hash string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE file_hash = $1`, assetSelectColumns)
	return collectOne[model.Asset](r.db.Query(ctx, query, hash))
}

// Delete deletes assets with everything referencing them and returns their storage paths.
func (r *AssetRepository) Delete(ctx context.Context, ids []string) ([]string, error) {
	query := `DELETE FROM core.assets WHERE id = ANY($1::uuid[]) RETURNING storage_path`
	return collectScalars[string](r.db.Query(ctx, query, ids))
}
