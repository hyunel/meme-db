package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

const userSelectColumns = `id, username, email, password_hash, created_at, updated_at`

type UserRepository struct {
	db db.DBTX
}

func NewUserRepository(db db.DBTX) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) CreateUser(ctx context.Context, username, email, passwordHash string) (*model.User, error) {
	query := fmt.Sprintf(`
		INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
		RETURNING %s
	`, userSelectColumns)

	rows, err := r.db.Query(ctx, query, username, email, passwordHash)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	user, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("failed to scan created user: %w", err)
	}
	return &user, nil
}

func (r *UserRepository) GetUser(ctx context.Context, id string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE id = $1::uuid`, userSelectColumns)
	rows, err := r.db.Query(ctx, query, id)
	if err != nil {
		return nil, err
	}

	user, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.User])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE username = $1`, userSelectColumns)
	rows, err := r.db.Query(ctx, query, username)
	if err != nil {
		return nil, err
	}

	user, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.User])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE email = $1`, userSelectColumns)
	rows, err := r.db.Query(ctx, query, email)
	if err != nil {
		return nil, err
	}

	user, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.User])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}
