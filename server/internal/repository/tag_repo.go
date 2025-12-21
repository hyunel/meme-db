package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

type TagRepository struct {
	db db.DBTX
}

func NewTagRepository(db db.DBTX) *TagRepository {
	return &TagRepository{db: db}
}

func (r *TagRepository) CreateTag(ctx context.Context, name string, scope model.TagScope) (*model.Tag, error) {
	query := `
		INSERT INTO tags (name, type) VALUES ($1, $2)
		RETURNING id, name, type, created_at
	`
	var tag model.Tag
	err := r.db.QueryRow(ctx, query, name, scope).Scan(&tag.ID, &tag.Name, &tag.Type, &tag.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create tag: %w", err)
	}
	return &tag, nil
}

func (r *TagRepository) GetTag(ctx context.Context, id string) (*model.Tag, error) {
	query := `SELECT id, name, type, created_at FROM tags WHERE id = $1::uuid`
	var tag model.Tag
	err := r.db.QueryRow(ctx, query, id).Scan(&tag.ID, &tag.Name, &tag.Type, &tag.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &tag, nil
}

func (r *TagRepository) ListTags(ctx context.Context, scope *model.TagScope) ([]*model.Tag, error) {
	query := `SELECT id, name, type, created_at FROM tags`
	var args []interface{}
	if scope != nil {
		query += ` WHERE type = $1`
		args = append(args, *scope)
	}
	query += ` ORDER BY name ASC`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []*model.Tag
	for rows.Next() {
		var tag model.Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Type, &tag.CreatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, &tag)
	}
	return tags, nil
}

func (r *TagRepository) UpdateTag(ctx context.Context, id string, name string) (*model.Tag, error) {
	query := `
		UPDATE tags SET name = $1 WHERE id = $2::uuid
		RETURNING id, name, type, created_at
	`
	var tag model.Tag
	err := r.db.QueryRow(ctx, query, name, id).Scan(&tag.ID, &tag.Name, &tag.Type, &tag.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

func (r *TagRepository) DeleteTag(ctx context.Context, id string) error {
	query := `DELETE FROM tags WHERE id = $1::uuid`
	_, err := r.db.Exec(ctx, query, id)
	return err
}

func (r *TagRepository) AddTagToNode(ctx context.Context, nodeID string, tagID string) error {
	query := `INSERT INTO node_tags (node_id, tag_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`
	_, err := r.db.Exec(ctx, query, nodeID, tagID)
	return err
}

func (r *TagRepository) RemoveTagFromNode(ctx context.Context, nodeID string, tagID string) error {
	query := `DELETE FROM node_tags WHERE node_id = $1::uuid AND tag_id = $2::uuid`
	_, err := r.db.Exec(ctx, query, nodeID, tagID)
	return err
}

func (r *TagRepository) GetNodeTags(ctx context.Context, nodeID string) ([]*model.Tag, error) {
	query := `
		SELECT t.id, t.name, t.type, t.created_at
		FROM tags t
		JOIN node_tags nt ON t.id = nt.tag_id
		WHERE nt.node_id = $1::uuid
	`
	rows, err := r.db.Query(ctx, query, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []*model.Tag
	for rows.Next() {
		var tag model.Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Type, &tag.CreatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, &tag)
	}
	return tags, nil
}
