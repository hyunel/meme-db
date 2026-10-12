package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5"
)

type FavoriteRepository struct {
	db db.DBTX
}

func (r *FavoriteRepository) Add(ctx context.Context, userID string, assetID, nodeID *string) error {
	query := `
		INSERT INTO library.favorites (user_id, asset_id, node_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (user_id, asset_id, node_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, userID, assetID, nodeID)
	return err
}

func (r *FavoriteRepository) Remove(ctx context.Context, userID string, assetIDs, nodeIDs []string) error {
	query := `
		DELETE FROM library.favorites
		WHERE user_id = $1::uuid AND (asset_id = ANY($2::uuid[]) OR node_id = ANY($3::uuid[]))
	`
	_, err := r.db.Exec(ctx, query, userID, assetIDs, nodeIDs)
	return err
}

// Folders lists the user's favorite folders, newest first.
func (r *FavoriteRepository) Folders(ctx context.Context, userID string) ([]string, error) {
	query := `SELECT node_id::text FROM library.favorites WHERE user_id = $1::uuid AND node_id IS NOT NULL ORDER BY id DESC`
	return collectScalars[string](r.db.Query(ctx, query, userID))
}

type FavoriteMeme struct {
	ID      string `db:"id"`
	AssetID string `db:"asset_id"`
}

// Memes lists the favorite memes the user may still see, newest first, from the one before the given favorite id if any.
func (r *FavoriteRepository) Memes(ctx context.Context, userID string, admin bool, before string, limit int) ([]*FavoriteMeme, error) {
	var w filter
	w.where("fv.user_id = " + w.arg(userID) + "::uuid")
	w.where(memeVisible(w.arg(userID), w.arg(admin)))
	if before != "" {
		w.where("fv.id < " + w.arg(before) + "::uuid")
	}
	query := fmt.Sprintf(`
		SELECT fv.id::text AS id, fv.asset_id::text AS asset_id
		FROM library.favorites fv JOIN core.meme_info m ON m.asset_id = fv.asset_id
		%s ORDER BY fv.id DESC LIMIT %d
	`, w.clause(), limit)
	return collectAll[FavoriteMeme](r.db.Query(ctx, query, w.args...))
}

// StaleMemes lists the user's favorite memes they can no longer see, e.g. because they were made private, and counts the others.
func (r *FavoriteRepository) StaleMemes(ctx context.Context, userID string, admin bool) (stale []string, visible int, err error) {
	query := fmt.Sprintf(`
		SELECT fv.asset_id::text, m.asset_id IS NOT NULL AND %s
		FROM library.favorites fv LEFT JOIN core.meme_info m ON m.asset_id = fv.asset_id
		WHERE fv.user_id = $1::uuid AND fv.asset_id IS NOT NULL
	`, memeVisible("$1", "$2"))
	rows, err := r.db.Query(ctx, query, userID, admin)
	if err != nil {
		return nil, 0, err
	}
	stale = []string{}
	var assetID string
	var ok bool
	_, err = pgx.ForEachRow(rows, []any{&assetID, &ok}, func() error {
		if ok {
			visible++
		} else {
			stale = append(stale, assetID)
		}
		return nil
	})
	return stale, visible, err
}
