package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const tokenSelectColumns = `id, user_id, name, hint, scope, expires_at, last_used_at, created_at`

type TokenRepository struct {
	db db.DBTX
}

func (r *TokenRepository) Create(ctx context.Context, token *model.APIToken, hash string) (*model.APIToken, error) {
	query := fmt.Sprintf(`
		INSERT INTO iam.api_tokens (user_id, name, token_hash, hint, scope, expires_at) VALUES ($1::uuid, $2, $3, $4, $5, $6)
		RETURNING %s
	`, tokenSelectColumns)
	return collectOne[model.APIToken](r.db.Query(ctx, query, token.UserID, token.Name, hash, token.Hint, token.Scope, token.ExpiresAt))
}

func (r *TokenRepository) GetByHash(ctx context.Context, hash string) (*model.APIToken, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.api_tokens WHERE token_hash = $1`, tokenSelectColumns)
	return collectOne[model.APIToken](r.db.Query(ctx, query, hash))
}

func (r *TokenRepository) List(ctx context.Context, userID string) ([]*model.APIToken, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.api_tokens WHERE user_id = $1::uuid ORDER BY created_at DESC`, tokenSelectColumns)
	return collectAll[model.APIToken](r.db.Query(ctx, query, userID))
}

func (r *TokenRepository) Touch(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE iam.api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, id)
	return err
}

func (r *TokenRepository) Delete(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM iam.api_tokens WHERE id = $1::uuid AND user_id = $2::uuid`, id, userID)
	return tag.RowsAffected() > 0, err
}
