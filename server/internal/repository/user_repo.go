package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

const userSelectColumns = `id, username, email, password_hash, role, created_at, updated_at`

type UserRepository struct {
	db db.DBTX
}

func (r *UserRepository) Create(ctx context.Context, username, email, passwordHash, role string) (*model.User, error) {
	query := fmt.Sprintf(`
		INSERT INTO iam.users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)
		RETURNING %s
	`, userSelectColumns)

	rows, err := r.db.Query(ctx, query, username, email, passwordHash, role)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("failed to scan created user: %w", err)
	}
	return &user, nil
}

func (r *UserRepository) Get(ctx context.Context, id string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE id = $1::uuid`, userSelectColumns)
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
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE username = $1`, userSelectColumns)
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
	query := fmt.Sprintf(`SELECT %s FROM iam.users WHERE email = $1`, userSelectColumns)
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
