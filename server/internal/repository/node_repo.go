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

func NewNodeRepository(db db.DBTX) *NodeRepository {
	return &NodeRepository{db: db}
}

// ==============================================================================
// CRUD Operations
// ==============================================================================

func (r *NodeRepository) CreateNode(ctx context.Context, node *model.Node) error {
	// Handle empty string ID by converting it to NULL for the database
	var nodeID *string
	if node.ID != "" {
		nodeID = &node.ID
	}

	query := fmt.Sprintf(`
		WITH new_node AS (
			SELECT
				CASE WHEN $1::uuid IS NULL THEN uuidv7() ELSE $1::uuid END as id
		)
		INSERT INTO nodes (
			id, owner_id, parent_id, path, name, type, visibility,
			asset_id, private_note, created_at, updated_at
		)
		SELECT
			n.id, $2::uuid, $3::uuid,
			CASE
				WHEN $3::uuid IS NULL THEN replace(n.id::text, '-', '')::ltree
				ELSE (SELECT path FROM nodes WHERE id = $3::uuid) || replace(n.id::text, '-', '')::ltree
			END,
			$4, $5, $6,
			$7::uuid, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		FROM new_node n
		RETURNING %s
	`, nodeSelectColumns)

	rows, err := r.db.Query(ctx, query,
		nodeID, node.OwnerID, node.ParentID,
		node.Name, node.Type, node.Visibility,
		node.AssetID, node.PrivateNote,
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

func (r *NodeRepository) GetNode(ctx context.Context, id string, ownerID string) (*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM nodes
		WHERE id = $1::uuid AND (owner_id = $2::uuid OR visibility = 'PUBLIC')
	`, nodeSelectColumns)

	rows, err := r.db.Query(ctx, query, id, ownerID)
	if err != nil {
		return nil, err
	}
	node, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.Node])
	if err != nil {
		return nil, err
	}
	return &node, nil
}

func (r *NodeRepository) GetNodes(ctx context.Context, ids []string, ownerID string) ([]*model.Node, error) {
	if len(ids) == 0 {
		return []*model.Node{}, nil
	}

	query := fmt.Sprintf(`
		SELECT %s
		FROM nodes
		WHERE id = ANY($1::uuid[]) AND (owner_id = $2::uuid OR visibility = 'PUBLIC')
	`, nodeSelectColumns)

	rows, err := r.db.Query(ctx, query, ids, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

func (r *NodeRepository) UpdateNode(ctx context.Context, node *model.Node) error {
	query := `
		UPDATE nodes
		SET name = $1, visibility = $2, private_note = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4::uuid AND owner_id = $5::uuid
	`
	_, err := r.db.Exec(ctx, query, node.Name, node.Visibility, node.PrivateNote, node.ID, node.OwnerID)
	return err
}

func (r *NodeRepository) DeleteNode(ctx context.Context, id string, ownerID string) error {
	query := `
		DELETE FROM nodes
		WHERE id = $1::uuid AND owner_id = $2::uuid
	`
	_, err := r.db.Exec(ctx, query, id, ownerID)
	if err != nil {
		return fmt.Errorf("failed to delete node %s and its children: %w", id, err)
	}
	return nil
}

func (r *NodeRepository) ListNodes(ctx context.Context, parentID *string, ownerID string) ([]*model.Node, error) {
	var query string
	var args []interface{}

	if parentID == nil {
		query = fmt.Sprintf(`
			SELECT %s
			FROM nodes
			WHERE parent_id IS NULL AND owner_id = $1::uuid
			ORDER BY type DESC, name ASC
		`, nodeSelectColumns)
		args = []interface{}{ownerID}
	} else {
		query = fmt.Sprintf(`
			SELECT %s
			FROM nodes
			WHERE parent_id = $1::uuid AND owner_id = $2::uuid
			ORDER BY type DESC, name ASC
		`, nodeSelectColumns)
		args = []interface{}{parentID, ownerID}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

// ==============================================================================
// Hierarchy Operations (Path/Tree)
// ==============================================================================

func (r *NodeRepository) MoveNode(ctx context.Context, id string, newParentID *string, newPath string, ownerID string) error {
	query := `
		UPDATE nodes
		SET
			parent_id = CASE WHEN nodes.id = $1::uuid THEN $2::uuid ELSE nodes.parent_id END,
			path = CASE
				WHEN nlevel(nodes.path) > nlevel(t.path) THEN $3::ltree || subpath(nodes.path, nlevel(t.path))
				ELSE $3::ltree
			END,
			updated_at = CURRENT_TIMESTAMP
		FROM (SELECT path FROM nodes WHERE id = $1::uuid AND owner_id = $4::uuid) AS t
		WHERE nodes.path <@ t.path AND nodes.owner_id = $4::uuid
	`
	_, err := r.db.Exec(ctx, query, id, newParentID, newPath, ownerID)
	if err != nil {
		return fmt.Errorf("failed to move node %s: %w", id, err)
	}
	return nil
}

func (r *NodeRepository) GetNodeByPath(ctx context.Context, path string) (*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM nodes WHERE path = $1::ltree
	`, nodeSelectColumns)
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

func (r *NodeRepository) GetSubtree(ctx context.Context, path string) ([]*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM nodes
		WHERE path <@ $1::ltree
		ORDER BY nlevel(path) ASC
	`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}

func (r *NodeRepository) GetAncestors(ctx context.Context, path string) ([]*model.Node, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM nodes
		WHERE path @> $1::ltree
		ORDER BY nlevel(path) ASC
	`, nodeSelectColumns)
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, fmt.Errorf("failed to get ancestors: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Node])
}
