package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const assetSelectColumns = `id, file_hash, file_size, mime_type, extension, storage_path, uploaded_by, created_at`

// assetURL links the file of the asset aliased a by its hash, which only someone already holding the file can work out.
const assetURL = `'/api/assets/' || a.file_hash`

type AssetRepository struct {
	db db.DBTX
}

// Create returns the stored asset and whether it was newly created (hashes are unique).
func (r *AssetRepository) Create(ctx context.Context, asset *model.Asset) (*model.Asset, bool, error) {
	query := fmt.Sprintf(`
		INSERT INTO core.assets (file_hash, file_size, mime_type, extension, storage_path, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6::uuid)
		ON CONFLICT (file_hash) DO NOTHING
		RETURNING %s
	`, assetSelectColumns)
	created, err := collectOne[model.Asset](r.db.Query(ctx, query, asset.FileHash, asset.FileSize, asset.MimeType, asset.Extension, asset.StoragePath, asset.UploadedBy))
	if err != nil || created != nil {
		return created, created != nil, err
	}
	existing, err := r.GetByHash(ctx, asset.FileHash)
	return existing, false, err
}

func (r *AssetRepository) Get(ctx context.Context, id string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE id = $1::uuid`, assetSelectColumns)
	return collectOne[model.Asset](r.db.Query(ctx, query, id))
}

func (r *AssetRepository) GetByHash(ctx context.Context, hash string) (*model.Asset, error) {
	query := fmt.Sprintf(`SELECT %s FROM core.assets WHERE file_hash = $1`, assetSelectColumns)
	return collectOne[model.Asset](r.db.Query(ctx, query, hash))
}

// StoragePaths lists where every file is stored.
func (r *AssetRepository) StoragePaths(ctx context.Context) ([]string, error) {
	return collectScalars[string](r.db.Query(ctx, `SELECT storage_path FROM core.assets ORDER BY created_at`))
}

func (r *AssetRepository) RecentUploads(ctx context.Context, userID string, limit int) ([]string, error) {
	query := `SELECT id::text FROM core.assets WHERE uploaded_by = $1::uuid ORDER BY created_at DESC LIMIT $2`
	return collectScalars[string](r.db.Query(ctx, query, userID, limit))
}

func (r *AssetRepository) Delete(ctx context.Context, ids []string) ([]string, error) {
	query := `DELETE FROM core.assets WHERE id = ANY($1::uuid[]) RETURNING storage_path`
	return collectScalars[string](r.db.Query(ctx, query, ids))
}
