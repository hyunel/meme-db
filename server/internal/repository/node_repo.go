package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

type NodeRepository struct {
	db db.DBTX
}

func NewNodeRepository(db db.DBTX) *NodeRepository {
	return &NodeRepository{db: db}
}

func (r *NodeRepository) GetNode(ctx context.Context, id string, ownerID string) (*model.Node, error) {
	query := `
		SELECT id, owner_id, parent_id, path::text, name, type, visibility,
			   asset_id, is_favorite, private_note, created_at, updated_at
		FROM nodes
		WHERE id = $1::uuid AND (owner_id = $2::uuid OR visibility = 'PUBLIC')
	`
	node := &model.Node{}
	err := r.db.QueryRow(ctx, query, id, ownerID).Scan(
		&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
		&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return node, nil
}

func (r *NodeRepository) CreateNode(ctx context.Context, node *model.Node) error {
	if node.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("failed to generate uuid: %w", err)
		}
		node.ID = id.String()
	}

	query := `
		INSERT INTO nodes (
			id, owner_id, parent_id, path, name, type, visibility,
			asset_id, is_favorite, private_note, created_at, updated_at
		)
		SELECT
			$1::uuid, $2::uuid, $3::uuid,
			CASE
				WHEN $3::uuid IS NULL THEN replace($1::text, '-', '')::ltree
				ELSE (SELECT path FROM nodes WHERE id = $3::uuid) || replace($1::text, '-', '')::ltree
			END,
			$4, $5, $6,
			$7::uuid, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		RETURNING path::text, created_at, updated_at
	`

	err := r.db.QueryRow(ctx, query,
		node.ID, node.OwnerID, node.ParentID,
		node.Name, node.Type, node.Visibility,
		node.AssetID, node.IsFavorite, node.PrivateNote,
	).Scan(&node.Path, &node.CreatedAt, &node.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to create node: %w", err)
	}
	return nil
}

func (r *NodeRepository) GetNodes(ctx context.Context, ids []string, ownerID string) ([]*model.Node, error) {
	if len(ids) == 0 {
		return []*model.Node{}, nil
	}

	query := `
		SELECT id, owner_id, parent_id, path::text, name, type, visibility,
			   asset_id, is_favorite, private_note, created_at, updated_at
		FROM nodes
		WHERE id = ANY($1::uuid[]) AND (owner_id = $2::uuid OR visibility = 'PUBLIC')
	`
	rows, err := r.db.Query(ctx, query, ids, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}
	defer rows.Close()

	nodes := make([]*model.Node, 0)
	for rows.Next() {
		node := &model.Node{}
		err := rows.Scan(
			&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
			&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan node: %w", err)
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func (r *NodeRepository) ListNodes(ctx context.Context, parentID *string, ownerID string) ([]*model.Node, error) {
	var query string
	var args []interface{}

	if parentID == nil {
		query = `
			SELECT id, owner_id, parent_id, path::text, name, type, visibility,
				   asset_id, is_favorite, private_note, created_at, updated_at
			FROM nodes
			WHERE parent_id IS NULL AND owner_id = $1::uuid
			ORDER BY type DESC, name ASC
		`
		args = []interface{}{ownerID}
	} else {
		query = `
			SELECT id, owner_id, parent_id, path::text, name, type, visibility,
				   asset_id, is_favorite, private_note, created_at, updated_at
			FROM nodes
			WHERE parent_id = $1::uuid AND owner_id = $2::uuid
			ORDER BY type DESC, name ASC
		`
		args = []interface{}{parentID, ownerID}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}
	defer rows.Close()

	nodes := make([]*model.Node, 0)
	for rows.Next() {
		node := &model.Node{}
		err := rows.Scan(
			&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
			&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan node: %w", err)
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func (r *NodeRepository) UpdateNode(ctx context.Context, node *model.Node) error {
	query := `
		UPDATE nodes
		SET name = $1, visibility = $2, is_favorite = $3, private_note = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $5::uuid AND owner_id = $6::uuid
	`
	_, err := r.db.Exec(ctx, query, node.Name, node.Visibility, node.IsFavorite, node.PrivateNote, node.ID, node.OwnerID)
	return err
}

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

func (r *NodeRepository) DeleteNode(ctx context.Context, id string, ownerID string) error {
	query := `
		DELETE FROM nodes
		WHERE path <@ (SELECT path FROM nodes WHERE id = $1::uuid AND owner_id = $2::uuid)
		AND owner_id = $2::uuid
	`
	_, err := r.db.Exec(ctx, query, id, ownerID)
	if err != nil {
		return fmt.Errorf("failed to delete node %s and its children: %w", id, err)
	}
	return nil
}

func (r *NodeRepository) GetNodeByPath(ctx context.Context, path string) (*model.Node, error) {
	query := `
		SELECT id, owner_id, parent_id, path::text, name, type, visibility,
			   asset_id, is_favorite, private_note, created_at, updated_at
		FROM nodes WHERE path = $1::ltree
	`
	node := &model.Node{}
	err := r.db.QueryRow(ctx, query, path).Scan(
		&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
		&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return node, nil
}

func (r *NodeRepository) GetSubtree(ctx context.Context, path string) ([]*model.Node, error) {
	query := `
		SELECT id, owner_id, parent_id, path::text, name, type, visibility,
			   asset_id, is_favorite, private_note, created_at, updated_at
		FROM nodes
		WHERE path <@ $1::ltree
		ORDER BY nlevel(path) ASC
	`
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := make([]*model.Node, 0)
	for rows.Next() {
		node := &model.Node{}
		err := rows.Scan(
			&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
			&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func (r *NodeRepository) GetAncestors(ctx context.Context, path string) ([]*model.Node, error) {
	query := `
		SELECT id, owner_id, parent_id, path::text, name, type, visibility,
			   asset_id, is_favorite, private_note, created_at, updated_at
		FROM nodes
		WHERE path @> $1::ltree
		ORDER BY nlevel(path) ASC
	`
	rows, err := r.db.Query(ctx, query, path)
	if err != nil {
		return nil, fmt.Errorf("failed to get ancestors: %w", err)
	}
	defer rows.Close()

	nodes := make([]*model.Node, 0)
	for rows.Next() {
		node := &model.Node{}
		err := rows.Scan(
			&node.ID, &node.OwnerID, &node.ParentID, &node.Path, &node.Name, &node.Type, &node.Visibility,
			&node.AssetID, &node.IsFavorite, &node.PrivateNote, &node.CreatedAt, &node.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan ancestor node: %w", err)
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}
