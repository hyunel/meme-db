package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
)

type FavoriteRepository struct {
	db db.DBTX
}

func NewFavoriteRepository(db db.DBTX) *FavoriteRepository {
	return &FavoriteRepository{db: db}
}

func (r *FavoriteRepository) AddAssetFavorite(ctx context.Context, userID, assetID string) error {
	query := `
		INSERT INTO favorites (user_id, asset_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, userID, assetID)
	return err
}

func (r *FavoriteRepository) RemoveAssetFavorite(ctx context.Context, userID, assetID string) error {
	query := `
		DELETE FROM favorites
		WHERE user_id = $1::uuid AND asset_id = $2::uuid
	`
	_, err := r.db.Exec(ctx, query, userID, assetID)
	return err
}

func (r *FavoriteRepository) AddNodeFavorite(ctx context.Context, userID, nodeID string) error {
	query := `
		INSERT INTO favorites (user_id, node_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, userID, nodeID)
	return err
}

func (r *FavoriteRepository) RemoveNodeFavorite(ctx context.Context, userID, nodeID string) error {
	query := `
		DELETE FROM favorites
		WHERE user_id = $1::uuid AND node_id = $2::uuid
	`
	_, err := r.db.Exec(ctx, query, userID, nodeID)
	return err
}

func (r *FavoriteRepository) IsAssetFavorite(ctx context.Context, userID, assetID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM favorites
			WHERE user_id = $1::uuid AND asset_id = $2::uuid
		)
	`
	var exists bool
	err := r.db.QueryRow(ctx, query, userID, assetID).Scan(&exists)
	return exists, err
}

func (r *FavoriteRepository) IsNodeFavorite(ctx context.Context, userID, nodeID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM favorites
			WHERE user_id = $1::uuid AND node_id = $2::uuid
		)
	`
	var exists bool
	err := r.db.QueryRow(ctx, query, userID, nodeID).Scan(&exists)
	return exists, err
}

func (r *FavoriteRepository) GetFavorites(ctx context.Context, userID string, nodeIDs, assetIDs []string) (map[string]bool, map[string]bool, error) {
	nodeFavs := make(map[string]bool)
	assetFavs := make(map[string]bool)

	if len(nodeIDs) == 0 && len(assetIDs) == 0 {
		return nodeFavs, assetFavs, nil
	}

	query := `
		SELECT node_id, asset_id
		FROM favorites
		WHERE user_id = $1::uuid
		AND (
			(node_id = ANY($2::uuid[])) OR
			(asset_id = ANY($3::uuid[]))
		)
	`

	rows, err := r.db.Query(ctx, query, userID, nodeIDs, assetIDs)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var nodeID, assetID *string
		if err := rows.Scan(&nodeID, &assetID); err != nil {
			return nil, nil, err
		}
		if nodeID != nil {
			nodeFavs[*nodeID] = true
		}
		if assetID != nil {
			assetFavs[*assetID] = true
		}
	}

	return nodeFavs, assetFavs, nil
}
