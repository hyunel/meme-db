package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

const userSelectColumns = `id, username, email, password_hash, role, status, created_at, updated_at`

const userStatsColumns = `
	(SELECT count(*) FROM library.nodes n WHERE n.owner_id = u.id AND n.type = 'FILE') AS files,
	(SELECT count(*) FROM library.nodes n WHERE n.owner_id = u.id AND n.type = 'FOLDER') AS folders,
	(SELECT count(*) FROM library.favorites f WHERE f.user_id = u.id) AS favorites`

type UserRepository struct {
	db db.DBTX
}

func (r *UserRepository) Create(ctx context.Context, username, email, passwordHash, role string) (*model.User, error) {
	query := fmt.Sprintf(`
		INSERT INTO iam.users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)
		RETURNING %s
	`, userSelectColumns)
	return collectOne[model.User](r.db.Query(ctx, query, username, email, passwordHash, role))
}

func (r *UserRepository) Get(ctx context.Context, id string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE id = $1::uuid`, userSelectColumns)
	return collectOne[model.User](r.db.Query(ctx, query, id))
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE lower(username) = lower($1)`, userSelectColumns)
	return collectOne[model.User](r.db.Query(ctx, query, username))
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE lower(email) = lower($1)`, userSelectColumns)
	return collectOne[model.User](r.db.Query(ctx, query, email))
}

func (r *UserRepository) SetPassword(ctx context.Context, id, passwordHash string) error {
	_, err := r.db.Exec(ctx, `UPDATE iam.users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, id, passwordHash)
	return err
}

func (r *UserRepository) Update(ctx context.Context, id string, role, status *string) error {
	query := `
		UPDATE iam.users SET role = COALESCE($2, role), status = COALESCE($3, status), updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid
	`
	_, err := r.db.Exec(ctx, query, id, role, status)
	return err
}

func (r *UserRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM iam.users WHERE id = $1::uuid`, id)
	return err
}

func (r *UserRepository) LockActiveAdmins(ctx context.Context) (int, error) {
	ids, err := collectScalars[string](r.db.Query(ctx, `SELECT id::text FROM iam.users WHERE role = 'admin' AND status = 'active' FOR UPDATE`))
	return len(ids), err
}

func (r *UserRepository) Stats(ctx context.Context, id string) (*model.UserStats, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.users u WHERE u.id = $1::uuid`, userStatsColumns)
	return collectOne[model.UserStats](r.db.Query(ctx, query, id))
}

type UserFilter struct {
	Query   string // Matches username or email
	Role    string
	Status  string
	Created TimeRange
	Sort    string // newest (default) | oldest | name
}

func (r *UserRepository) List(ctx context.Context, f UserFilter, page Page) ([]*model.AdminUser, int, error) {
	var w filter
	if f.Query != "" {
		p := w.arg("%" + f.Query + "%")
		w.where(fmt.Sprintf("(u.username ILIKE %s OR u.email ILIKE %s)", p, p))
	}
	if f.Role != "" {
		w.where("u.role = " + w.arg(f.Role))
	}
	if f.Status != "" {
		w.where("u.status = " + w.arg(f.Status))
	}
	w.timeRange("u.created_at", f.Created)

	total, err := count(ctx, r.db, "SELECT count(*) FROM iam.users u "+w.clause(), w.args...)
	if err != nil {
		return nil, 0, err
	}

	order := map[string]string{"oldest": "u.created_at", "name": "u.username"}[f.Sort]
	if order == "" {
		order = "u.created_at DESC"
	}
	query := fmt.Sprintf(`SELECT %s, %s FROM iam.users u %s ORDER BY %s %s`,
		prefixed("u", userSelectColumns), userStatsColumns, w.clause(), order, page.clause())
	users, err := collectAll[model.AdminUser](r.db.Query(ctx, query, w.args...))
	return users, total, err
}
