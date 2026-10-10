package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5"
)

type FavoriteRepository struct {
	db db.DBTX
}

// Add favorites one target: an asset or a node.
func (r *FavoriteRepository) Add(ctx context.Context, userID string, assetID, nodeID *string) error {
	query := `
		INSERT INTO library.favorites (user_id, asset_id, node_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, userID, assetID, nodeID)
	return err
}

// Remove unfavorites targets: assets or nodes.
func (r *FavoriteRepository) Remove(ctx context.Context, userID string, assetIDs, nodeIDs []string) error {
	query := `
		DELETE FROM library.favorites
		WHERE user_id = $1::uuid AND (asset_id = ANY($2::uuid[]) OR node_id = ANY($3::uuid[]))
	`
	_, err := r.db.Exec(ctx, query, userID, assetIDs, nodeIDs)
	return err
}

// List returns a user's favorite asset and node IDs, newest first.
func (r *FavoriteRepository) List(ctx context.Context, userID string) (assetIDs, nodeIDs []string, err error) {
	query := `SELECT asset_id::text, node_id::text FROM library.favorites WHERE user_id = $1::uuid ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, nil, err
	}
	var assetID, nodeID *string
	_, err = pgx.ForEachRow(rows, []any{&assetID, &nodeID}, func() error {
		if assetID != nil {
			assetIDs = append(assetIDs, *assetID)
		} else if nodeID != nil {
			nodeIDs = append(nodeIDs, *nodeID)
		}
		return nil
	})
	return assetIDs, nodeIDs, err
}
