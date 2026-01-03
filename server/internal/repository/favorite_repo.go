package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
)

type FavoriteRepository struct {
	db db.DBTX
}

// AddAssets adds assets to favorites. RLS ensures user_id = current user.
func (r *FavoriteRepository) AddAssets(ctx context.Context, assetIDs []string) error {
	query := `
		INSERT INTO library.favorites (user_id, asset_id)
		SELECT current_app_user_id(), unnest($1::uuid[])
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, assetIDs)
	return err
}

// RemoveAssets removes assets from favorites.
func (r *FavoriteRepository) RemoveAssets(ctx context.Context, assetIDs []string) error {
	query := `DELETE FROM library.favorites WHERE asset_id = ANY($1::uuid[])`
	_, err := r.db.Exec(ctx, query, assetIDs)
	return err
}

// AddNodes adds nodes (folders) to favorites.
func (r *FavoriteRepository) AddNodes(ctx context.Context, nodeIDs []string) error {
	query := `
		INSERT INTO library.favorites (user_id, node_id)
		SELECT current_app_user_id(), unnest($1::uuid[])
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, nodeIDs)
	return err
}

// RemoveNodes removes nodes from favorites.
func (r *FavoriteRepository) RemoveNodes(ctx context.Context, nodeIDs []string) error {
	query := `DELETE FROM library.favorites WHERE node_id = ANY($1::uuid[])`
	_, err := r.db.Exec(ctx, query, nodeIDs)
	return err
}

// GetStatus returns favorite status for the given nodes and assets.
func (r *FavoriteRepository) GetStatus(ctx context.Context, nodeIDs, assetIDs []string) (map[string]bool, map[string]bool, error) {
	nodeFavs := make(map[string]bool)
	assetFavs := make(map[string]bool)

	if len(nodeIDs) == 0 && len(assetIDs) == 0 {
		return nodeFavs, assetFavs, nil
	}

	query := `
		SELECT node_id, asset_id FROM library.favorites
		WHERE (node_id = ANY($1::uuid[]) OR asset_id = ANY($2::uuid[]))
	`
	rows, err := r.db.Query(ctx, query, nodeIDs, assetIDs)
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

// List returns all favorite asset IDs and node IDs for the current user.
func (r *FavoriteRepository) List(ctx context.Context) ([]string, []string, error) {
	query := `SELECT asset_id, node_id FROM library.favorites`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var assetIDs, nodeIDs []string
	for rows.Next() {
		var assetID, nodeID *string
		if err := rows.Scan(&assetID, &nodeID); err != nil {
			return nil, nil, err
		}
		if assetID != nil {
			assetIDs = append(assetIDs, *assetID)
		}
		if nodeID != nil {
			nodeIDs = append(nodeIDs, *nodeID)
		}
	}

	return assetIDs, nodeIDs, nil
}
