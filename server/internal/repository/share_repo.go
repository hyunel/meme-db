package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const shareLinkColumns = `token::text, view_count, save_count, last_viewed_at, created_at`

// live holds while link s opens anything: a folder link lasts as long as its folder,
// and a meme link while its creator keeps the meme in their library.
const live = `(s.folder_id IS NOT NULL OR EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = s.asset_id AND n.owner_id = s.owner_id))`

type ShareRepository struct {
	db db.DBTX
}

// Get finds the owner's link to a meme or folder by the id of either.
func (r *ShareRepository) Get(ctx context.Context, ownerID, targetID string) (*model.ShareLink, error) {
	query := `SELECT ` + shareLinkColumns + ` FROM library.share_links WHERE owner_id = $1::uuid AND $2::uuid IN (asset_id, folder_id)`
	return collectOne[model.ShareLink](r.db.Query(ctx, query, ownerID, targetID))
}

func (r *ShareRepository) List(ctx context.Context, ownerID string) ([]*model.SharedItem, error) {
	query := `SELECT ` + shareLinkColumns + `, asset_id::text, folder_id::text, ` + live + ` AS live
		FROM library.share_links s WHERE owner_id = $1::uuid ORDER BY created_at DESC`
	return collectAll[model.SharedItem](r.db.Query(ctx, query, ownerID))
}

// Create returns the owner's link to a meme or folder, whichever of assetID and folderID is set, making one if there is none.
func (r *ShareRepository) Create(ctx context.Context, ownerID, assetID, folderID string) (*model.ShareLink, error) {
	target := "owner_id, asset_id"
	if folderID != "" {
		target = "folder_id"
	}
	query := `
		INSERT INTO library.share_links (owner_id, asset_id, folder_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (` + target + `) DO UPDATE SET owner_id = EXCLUDED.owner_id
		RETURNING ` + shareLinkColumns
	return collectOne[model.ShareLink](r.db.Query(ctx, query, ownerID, nullable(assetID), nullable(folderID)))
}

func (r *ShareRepository) Delete(ctx context.Context, ownerID, targetID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.share_links WHERE owner_id = $1::uuid AND $2::uuid IN (asset_id, folder_id)`, ownerID, targetID)
	return err
}

// Opens reports whether the token opens the asset: its creator is active and keeps the asset in their library,
// where the link is to the asset or to a folder holding it.
func (r *ShareRepository) Opens(ctx context.Context, token, assetID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM library.share_links s
			JOIN iam.users u ON u.id = s.owner_id AND u.status = 'active'
			JOIN library.nodes n ON n.owner_id = s.owner_id AND n.asset_id = $2::uuid
			WHERE s.token = $1::uuid
			  AND (s.asset_id = n.asset_id OR n.path <@ (SELECT f.path FROM library.nodes f WHERE f.id = s.folder_id))
		)
	`
	var ok bool
	err := r.db.QueryRow(ctx, query, token, assetID).Scan(&ok)
	return ok, err
}

// Folder returns the id of the folder the token links to if that folder is or holds the node at path, otherwise "".
func (r *ShareRepository) Folder(ctx context.Context, token, path string) (string, error) {
	query := `
		SELECT COALESCE((
			SELECT f.id::text FROM library.share_links s JOIN library.nodes f ON f.id = s.folder_id
			WHERE s.token = $1::uuid AND f.path @> $2::ltree
		), '')
	`
	var id string
	err := r.db.QueryRow(ctx, query, token, path).Scan(&id)
	return id, err
}

// Record counts a view, or a save when saved is set, of what a live link opens by someone other than its creator.
func (r *ShareRepository) Record(ctx context.Context, token, targetID, viewerID string, saved bool) error {
	set := `view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP`
	if saved {
		set = `save_count = save_count + 1`
	}
	query := `UPDATE library.share_links s SET ` + set + `
		WHERE s.token = $1::uuid AND $2::uuid IN (s.asset_id, s.folder_id) AND s.owner_id IS DISTINCT FROM $3::uuid AND ` + live
	_, err := r.db.Exec(ctx, query, token, targetID, nullable(viewerID))
	return err
}
