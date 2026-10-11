package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const shareLinkColumns = `token::text, view_count, save_count, last_viewed_at, created_at`

// keptBy holds while the creator of link s keeps its asset in their library, which the link needs.
const keptBy = `EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = s.asset_id AND n.owner_id = s.owner_id)`

type ShareRepository struct {
	db db.DBTX
}

func (r *ShareRepository) Get(ctx context.Context, ownerID, assetID string) (*model.ShareLink, error) {
	query := `SELECT ` + shareLinkColumns + ` FROM library.share_links WHERE owner_id = $1::uuid AND asset_id = $2::uuid`
	return collectOne[model.ShareLink](r.db.Query(ctx, query, ownerID, assetID))
}

func (r *ShareRepository) List(ctx context.Context, ownerID string) ([]*model.SharedMeme, error) {
	query := `SELECT ` + shareLinkColumns + `, asset_id::text, ` + keptBy + ` AS live
		FROM library.share_links s WHERE owner_id = $1::uuid ORDER BY created_at DESC`
	return collectAll[model.SharedMeme](r.db.Query(ctx, query, ownerID))
}

// Create returns the owner's link to the asset, making one if there is none.
func (r *ShareRepository) Create(ctx context.Context, ownerID, assetID string) (*model.ShareLink, error) {
	query := `
		INSERT INTO library.share_links (owner_id, asset_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (owner_id, asset_id) DO UPDATE SET owner_id = EXCLUDED.owner_id
		RETURNING ` + shareLinkColumns
	return collectOne[model.ShareLink](r.db.Query(ctx, query, ownerID, assetID))
}

func (r *ShareRepository) Delete(ctx context.Context, ownerID, assetID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.share_links WHERE owner_id = $1::uuid AND asset_id = $2::uuid`, ownerID, assetID)
	return err
}

// Opens reports whether the token links to the asset while its creator is active and keeps the asset in their library.
func (r *ShareRepository) Opens(ctx context.Context, token, assetID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM library.share_links s
			JOIN iam.users u ON u.id = s.owner_id AND u.status = 'active'
			WHERE s.token = $1::uuid AND s.asset_id = $2::uuid AND ` + keptBy + `
		)
	`
	var ok bool
	err := r.db.QueryRow(ctx, query, token, assetID).Scan(&ok)
	return ok, err
}

// Record counts a view, or a save when saved is set, of a live link by someone other than its creator.
func (r *ShareRepository) Record(ctx context.Context, token, assetID, viewerID string, saved bool) error {
	set := `view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP`
	if saved {
		set = `save_count = save_count + 1`
	}
	query := `UPDATE library.share_links s SET ` + set + `
		WHERE s.token = $1::uuid AND s.asset_id = $2::uuid AND s.owner_id IS DISTINCT FROM $3::uuid AND ` + keptBy
	_, err := r.db.Exec(ctx, query, token, assetID, nullable(viewerID))
	return err
}
