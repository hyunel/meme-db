package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const nodeSelectColumns = `id, owner_id, parent_id, path::text AS path, name, type, is_public, asset_id, created_at, updated_at`

func visibilityOf(alias string) string {
	return fmt.Sprintf(`CASE WHEN %[1]s.is_public THEN 'public'
		WHEN EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> %[1]s.path) THEN 'inherited'
		ELSE 'private' END`, alias)
}

type NodeRepository struct {
	db db.DBTX
}

// Lock holds, until the transaction ends, the lock on the owner's folder, or on their library root if folderID is nil.
func (r *NodeRepository) Lock(ctx context.Context, ownerID string, folderID *string) error {
	_, err := r.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(COALESCE($2::uuid, $1::uuid)::text, 0))`, ownerID, folderID)
	return err
}

// Inserts a node into the parent ($2), which must be one of the owner's ($1) folders, or at the root if it is null.
const insertNode = `
	INSERT INTO library.nodes (id, owner_id, parent_id, path, name, type, is_public, asset_id)
	SELECT n.id, $1::uuid, p.id, COALESCE(p.path, ''::ltree) || replace(n.id::text, '-', '')::ltree, $3, $4, $5, $6::uuid
	FROM (SELECT uuidv7() AS id) n
	LEFT JOIN library.nodes p ON p.id = $2::uuid AND p.owner_id = $1::uuid AND p.type = 'FOLDER'
	WHERE $2::uuid IS NULL OR p.id IS NOT NULL
`

// Create returns nil if the parent is not one of the owner's folders.
func (r *NodeRepository) Create(ctx context.Context, node *model.Node) (*model.Node, error) {
	return collectOne[model.Node](r.db.Query(ctx, insertNode+"RETURNING "+nodeSelectColumns,
		node.OwnerID, node.ParentID, node.Name, node.Type, node.IsPublic, node.AssetID))
}

// EnsureFolder returns the owner's node named name in the parent, a new folder if there was none, or nil if the parent is not one of their folders.
// The no-op update makes a conflict return the node already there.
func (r *NodeRepository) EnsureFolder(ctx context.Context, ownerID string, parentID *string, name string) (*model.Node, error) {
	query := insertNode + "ON CONFLICT (owner_id, parent_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING " + nodeSelectColumns
	return collectOne[model.Node](r.db.Query(ctx, query, ownerID, parentID, name, model.NodeTypeFolder, false, nil))
}

func (r *NodeRepository) Get(ctx context.Context, id string) (*model.Node, error) {
	query := fmt.Sprintf(`SELECT %s FROM library.nodes WHERE id = $1::uuid`, nodeSelectColumns)
	return collectOne[model.Node](r.db.Query(ctx, query, id))
}

func (r *NodeRepository) GetOwned(ctx context.Context, ownerID string, ids []string) ([]*model.Node, error) {
	query := fmt.Sprintf(`SELECT %s FROM library.nodes WHERE id = ANY($1::uuid[]) AND owner_id = $2::uuid`, nodeSelectColumns)
	return collectAll[model.Node](r.db.Query(ctx, query, ids, ownerID))
}

func (r *NodeRepository) Children(ctx context.Context, ownerID string, parentID *string) ([]*model.Node, error) {
	var w filter
	w.where("owner_id = " + w.arg(ownerID) + "::uuid")
	if parentID == nil {
		w.where("parent_id IS NULL")
	} else {
		w.where("parent_id = " + w.arg(*parentID) + "::uuid")
	}
	query := fmt.Sprintf(`SELECT %s FROM library.nodes %s ORDER BY created_at`, nodeSelectColumns, w.clause())
	return collectAll[model.Node](r.db.Query(ctx, query, w.args...))
}

// FileQuery picks the files of a folder, or of the root of a library, whose memes the viewer may see.
type FileQuery struct {
	ViewerID   string
	Admin      bool
	OwnerID    string
	ParentID   *string // Nil for the root
	PublicOnly bool
}

func (q FileQuery) filter() filter {
	var w filter
	w.where("c.owner_id = " + w.arg(q.OwnerID) + "::uuid AND c.type = 'FILE'")
	if q.ParentID == nil {
		w.where("c.parent_id IS NULL")
	} else {
		w.where("c.parent_id = " + w.arg(*q.ParentID) + "::uuid")
	}
	if q.PublicOnly {
		w.where("c.is_public")
	}
	w.where(memeVisible(w.arg(nullable(q.ViewerID)), w.arg(q.Admin)))
	return w
}

// Files lists the files oldest first, from the one after the given id if any.
func (r *NodeRepository) Files(ctx context.Context, q FileQuery, after string, limit int) ([]*model.Node, error) {
	w := q.filter()
	if after != "" {
		w.where("c.id > " + w.arg(after) + "::uuid")
	}
	query := fmt.Sprintf(`SELECT %s FROM library.nodes c JOIN core.meme_info m ON m.asset_id = c.asset_id %s ORDER BY c.id LIMIT %d`,
		prefixed("c", nodeSelectColumns), w.clause(), limit)
	return collectAll[model.Node](r.db.Query(ctx, query, w.args...))
}

func (r *NodeRepository) CountFiles(ctx context.Context, q FileQuery) (int, error) {
	w := q.filter()
	return count(ctx, r.db, "SELECT count(*) FROM library.nodes c JOIN core.meme_info m ON m.asset_id = c.asset_id "+w.clause(), w.args...)
}

func (r *NodeRepository) Ancestors(ctx context.Context, path string) ([]*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s FROM library.nodes WHERE path @> $1::ltree AND path <> $1::ltree ORDER BY nlevel(path)
	`, nodeSelectColumns)
	return collectAll[model.Node](r.db.Query(ctx, query, path))
}

func (r *NodeRepository) FolderTree(ctx context.Context, ownerID string) ([]*model.FolderRef, error) {
	query := `SELECT id, parent_id, name FROM library.nodes WHERE owner_id = $1::uuid AND type = 'FOLDER' ORDER BY name`
	return collectAll[model.FolderRef](r.db.Query(ctx, query, ownerID))
}

func (r *NodeRepository) Rename(ctx context.Context, id, name string) error {
	_, err := r.db.Exec(ctx, `UPDATE library.nodes SET name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, id, name)
	return err
}

func (r *NodeRepository) SetPublic(ctx context.Context, ownerID string, ids []string, isPublic bool) error {
	// Making a folder private clears the flags inside it too, so nothing in it stays public.
	query := `
		UPDATE library.nodes n SET is_public = $3, updated_at = CURRENT_TIMESTAMP
		FROM library.nodes t
		WHERE t.id = ANY($1::uuid[]) AND t.owner_id = $2::uuid
		  AND (n.id = t.id OR (NOT $3 AND n.is_public AND n.path <@ t.path))
	`
	_, err := r.db.Exec(ctx, query, ids, ownerID, isPublic)
	return err
}

func (r *NodeRepository) Move(ctx context.Context, id string, newParentID *string, newPath, name string) error {
	query := `
		UPDATE library.nodes
		SET
			parent_id = CASE WHEN library.nodes.id = $1::uuid THEN $2::uuid ELSE library.nodes.parent_id END,
			name = CASE WHEN library.nodes.id = $1::uuid THEN $4 ELSE library.nodes.name END,
			path = CASE WHEN library.nodes.id = $1::uuid THEN $3::ltree
				ELSE $3::ltree || subpath(library.nodes.path, nlevel(t.path)) END,
			updated_at = CURRENT_TIMESTAMP
		FROM (SELECT path FROM library.nodes WHERE id = $1::uuid) AS t
		WHERE library.nodes.path <@ t.path
	`
	if _, err := r.db.Exec(ctx, query, id, newParentID, newPath, name); err != nil {
		return fmt.Errorf("failed to move node %s: %w", id, err)
	}
	return nil
}

func (r *NodeRepository) Delete(ctx context.Context, ownerID string, ids []string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.nodes WHERE id = ANY($1::uuid[]) AND owner_id = $2::uuid`, ids, ownerID)
	return err
}

type folderRow struct {
	ID            string            `db:"id"`
	ParentID      *string           `db:"parent_id"`
	Name          string            `db:"name"`
	Visibility    string            `db:"visibility"`
	OwnerID       string            `db:"owner_id"`
	OwnerUsername string            `db:"owner_username"`
	ItemCount     int               `db:"item_count"`
	Previews      []model.MemeThumb `db:"previews"`
	FavoriteCount int               `db:"favorite_count"`
	IsFavorite    bool              `db:"is_favorite"`
	CreatedAt     time.Time         `db:"created_at"`
}

func (r *NodeRepository) Folders(ctx context.Context, viewerID string, ids []string) ([]*model.Folder, error) {
	if len(ids) == 0 {
		return []*model.Folder{}, nil
	}
	query := fmt.Sprintf(`
		SELECT f.id, f.parent_id, f.name, f.created_at, %s AS visibility,
			u.id AS owner_id, u.username AS owner_username,
			(SELECT count(*) FROM library.nodes c WHERE c.path <@ f.path AND c.type = 'FILE') AS item_count,
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object('id', p.asset_id, 'mime_type', p.mime_type) ORDER BY p.created_at)
				FROM (
					SELECT c.asset_id, a.mime_type, c.created_at
					FROM library.nodes c
					JOIN core.assets a ON a.id = c.asset_id
					JOIN core.meme_info mi ON mi.asset_id = c.asset_id
					WHERE c.path <@ f.path AND c.type = 'FILE' AND mi.processing_status = 'success'
					ORDER BY c.created_at LIMIT 4
				) p
			), '[]') AS previews,
			(SELECT count(*) FROM library.favorites fv WHERE fv.node_id = f.id) AS favorite_count,
			EXISTS (SELECT 1 FROM library.favorites fv WHERE fv.node_id = f.id AND fv.user_id = $2::uuid) AS is_favorite
		FROM library.nodes f
		JOIN iam.users u ON u.id = f.owner_id
		WHERE f.id = ANY($1::uuid[]) AND f.type = 'FOLDER'
	`, visibilityOf("f"))

	rows, err := collectAll[folderRow](r.db.Query(ctx, query, ids, nullable(viewerID)))
	if err != nil {
		return nil, err
	}
	folders := make([]*model.Folder, len(rows))
	for i, row := range rows {
		folders[i] = &model.Folder{
			ID:            row.ID,
			ParentID:      row.ParentID,
			Name:          row.Name,
			Visibility:    row.Visibility,
			Owner:         model.UserRef{ID: row.OwnerID, Username: row.OwnerUsername},
			ItemCount:     row.ItemCount,
			Previews:      row.Previews,
			FavoriteCount: row.FavoriteCount,
			IsFavorite:    row.IsFavorite,
			CreatedAt:     row.CreatedAt,
		}
	}
	return folders, nil
}

// MemeFolders lists the folders directly holding the asset that the viewer may open:
// their own, then public ones of active users by favorites.
func (r *NodeRepository) MemeFolders(ctx context.Context, viewerID, assetID string, limit int) ([]string, error) {
	query := `
		SELECT f.id::text FROM library.nodes f
		JOIN iam.users u ON u.id = f.owner_id
		WHERE f.id IN (SELECT parent_id FROM library.nodes WHERE asset_id = $1::uuid AND type = 'FILE')
		  AND (f.owner_id = $2::uuid OR (u.status = 'active'
		    AND EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> f.path)))
		ORDER BY (f.owner_id = $2::uuid) IS TRUE DESC,
			(SELECT count(*) FROM library.favorites fv WHERE fv.node_id = f.id) DESC, f.created_at DESC
		LIMIT $3
	`
	return collectScalars[string](r.db.Query(ctx, query, assetID, nullable(viewerID), limit))
}

func (r *NodeRepository) PublicRootFolders(ctx context.Context, ownerID string, limit int) ([]string, error) {
	query := `
		SELECT f.id::text FROM library.nodes f
		JOIN iam.users u ON u.id = f.owner_id AND u.status = 'active'
		WHERE f.type = 'FOLDER' AND f.is_public
		  AND ($1::uuid IS NULL OR f.owner_id = $1::uuid)
		  AND NOT EXISTS (SELECT 1 FROM library.nodes p WHERE p.is_public AND p.path @> f.path AND p.id <> f.id)
		ORDER BY (SELECT count(*) FROM library.favorites fv WHERE fv.node_id = f.id) DESC, f.created_at DESC
		LIMIT $2
	`
	return collectScalars[string](r.db.Query(ctx, query, nullable(ownerID), limit))
}
