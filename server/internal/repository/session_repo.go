package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const sessionSelectColumns = `id, user_id, user_agent, ip, expires_at, last_used_at, created_at`

type SessionRepository struct {
	db db.DBTX
}

func (r *SessionRepository) Create(ctx context.Context, session *model.Session, hash string) (*model.Session, error) {
	query := fmt.Sprintf(`
		INSERT INTO iam.sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING %s
	`, sessionSelectColumns)
	return collectOne[model.Session](r.db.Query(ctx, query, session.UserID, hash, session.UserAgent, session.IP, session.ExpiresAt))
}

// GetByHash finds a session that hasn't expired.
func (r *SessionRepository) GetByHash(ctx context.Context, hash string) (*model.Session, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.sessions WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP`, sessionSelectColumns)
	return collectOne[model.Session](r.db.Query(ctx, query, hash))
}

func (r *SessionRepository) List(ctx context.Context, userID string) ([]*model.Session, error) {
	query := fmt.Sprintf(`
		SELECT %s FROM iam.sessions WHERE user_id = $1::uuid AND expires_at > CURRENT_TIMESTAMP ORDER BY last_used_at DESC
	`, sessionSelectColumns)
	return collectAll[model.Session](r.db.Query(ctx, query, userID))
}

func (r *SessionRepository) Touch(ctx context.Context, id string, expires time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE iam.sessions SET last_used_at = CURRENT_TIMESTAMP, expires_at = $2 WHERE id = $1::uuid`, id, expires)
	return err
}

func (r *SessionRepository) Delete(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM iam.sessions WHERE id = $1::uuid AND user_id = $2::uuid`, id, userID)
	return tag.RowsAffected() > 0, err
}

// DeleteAll ends the user's sessions but the one kept, if any.
func (r *SessionRepository) DeleteAll(ctx context.Context, userID, keep string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM iam.sessions WHERE user_id = $1::uuid AND id::text <> $2`, userID, keep)
	return err
}

func (r *SessionRepository) DeleteExpired(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM iam.sessions WHERE user_id = $1::uuid AND expires_at <= CURRENT_TIMESTAMP`, userID)
	return err
}
