package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

const nodeSelectColumns = `id, owner_id, parent_id, path::text as path, name, type, visibility, asset_id, private_note, created_at, updated_at`

type NodeRepository struct {
	db db.DBTX
}

// Create creates a new node. RLS ensures owner_id matches current user.
func (r *NodeRepository) Create(ctx context.Context, node *model.Node) error {
	var nodeID *string
	if node.ID != "" {
		nodeID = &node.ID
	}

	query := fmt.Sprintf(`
		WITH new_node AS (
			SELECT CASE WHEN $1::uuid IS NULL THEN uuidv7() ELSE $1::uuid END as id
		)
		INSERT INTO library.nodes (id, owner_id, parent_id, path, name, type, visibility, asset_id, private_note)
		SELECT
			n.id, current_app_user_id(), $2::uuid,
			CASE
				WHEN $2::uuid IS NULL THEN replace(n.id::text, '-', '')::ltree
				ELSE (SELECT path FROM library.nodes WHERE id = $2::uuid) || replace(n.id::text, '-', '')::ltree
			END,
			$3, $4, $5, $6::uuid, $7
		FROM new_node n
		RETURNING %s
	`, nodeSelectColumns)

	rows, err := r.db.Query(ctx, query,
		nodeID, node.ParentID, node.Name, node.Type, node.Visibility, node.AssetID, node.PrivateNote,
	)
	if err != nil {
		return fmt.Errorf("failed to create node: %w", err)
	}

	newNode, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Node])
	if err != nil {
		return fmt.Errorf("failed to scan created node: %w", err)
	}
	*node = newNode
	return nil
}

// Get retrieves a node by ID. RLS filters by owner or public visibility.
func (r *NodeRepository) Get(ctx context.Context, id string) (*model.Node, error) {
	query := fmt.Sprintf(`SELECT %s FROM library.nodes WHERE id = $1::uuid`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, id)
	if err != nil {
		return nil, err
	}
	node, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Node])
	if err != nil {
		return nil, err
	}
	return &node, nil
}

// GetMany retrieves multiple nodes by IDs.
func (r *NodeRepository) GetMany(ctx context.Context, ids []string) ([]*model.Node, error) {
	if len(ids) == 0 {
		return []*model.Node{}, nil
	}
	query := fmt.Sprintf(`SELECT %s FROM library.nodes WHERE id = ANY($1::uuid[])`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

// List lists nodes under a parent. RLS filters automatically.
func (r *NodeRepository) List(ctx context.Context, parentID *string) ([]*model.Node, error) {
	var query string
	var args []interface{}

	if parentID == nil {
		query = fmt.Sprintf(`
			SELECT %s FROM library.nodes
			WHERE parent_id IS NULL AND owner_id = current_app_user_id()
			ORDER BY type DESC, name ASC
		`, nodeSelectColumns)
	} else {
		query = fmt.Sprintf(`
			SELECT %s FROM library.nodes
			WHERE parent_id = $1::uuid AND owner_id = current_app_user_id()
			ORDER BY type DESC, name ASC
		`, nodeSelectColumns)
		args = []interface{}{parentID}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

// Update updates a node's properties.
func (r *NodeRepository) Update(ctx context.Context, node *model.Node) error {
	query := `
		UPDATE library.nodes
		SET name = $1, visibility = $2, private_note = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4::uuid
	`
	_, err := r.db.Exec(ctx, query, node.Name, node.Visibility, node.PrivateNote, node.ID)
	return err
}

// Move moves a node and its subtree to a new parent.
func (r *NodeRepository) Move(ctx context.Context, id string, newParentID *string, newPath string) error {
	query := `
		UPDATE library.nodes
		SET
			parent_id = CASE WHEN library.nodes.id = $1::uuid THEN $2::uuid ELSE library.nodes.parent_id END,
			path = CASE
				WHEN nlevel(library.nodes.path) > nlevel(t.path) THEN $3::ltree || subpath(library.nodes.path, nlevel(t.path))
				ELSE $3::ltree
			END,
			updated_at = CURRENT_TIMESTAMP
		FROM (SELECT path FROM library.nodes WHERE id = $1::uuid) AS t
		WHERE library.nodes.path <@ t.path
	`
	_, err := r.db.Exec(ctx, query, id, newParentID, newPath)
	if err != nil {
		return fmt.Errorf("failed to move node %s: %w", id, err)
	}
	return nil
}

// Delete deletes a node and its children (via CASCADE).
func (r *NodeRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.nodes WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("failed to delete node %s: %w", id, err)
	}
	return nil
}

// GetByPath retrieves a node by its ltree path.
func (r *NodeRepository) GetByPath(ctx context.Context, path string) (*model.Node, error) {
	query := fmt.Sprintf(`SELECT %s FROM library.nodes WHERE path = $1::ltree`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, err
	}
	node, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Node])
	if err != nil {
		return nil, err
	}
	return &node, nil
}

// GetSubtree retrieves all nodes under a path.
func (r *NodeRepository) GetSubtree(ctx context.Context, path string) ([]*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s FROM library.nodes WHERE path <@ $1::ltree ORDER BY nlevel(path) ASC
	`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

// GetAncestors retrieves all ancestor nodes of a path.
func (r *NodeRepository) GetAncestors(ctx context.Context, path string) ([]*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s FROM library.nodes WHERE path @> $1::ltree ORDER BY nlevel(path) ASC
	`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, fmt.Errorf("failed to get ancestors: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}
