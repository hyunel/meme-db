package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBTX is the common interface for database operations (pgxpool.Pool, pgx.Tx, etc).
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Conn wraps a pooled connection with optional RLS context.
type Conn struct {
	*pgxpool.Conn
}

// Acquire gets a connection from pool, optionally setting RLS user context.
func Acquire(ctx context.Context, pool *pgxpool.Pool, userID string) (*Conn, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire connection: %w", err)
	}

	if userID != "" {
		if _, err := conn.Exec(ctx, "SELECT set_config('app.current_user_id', $1, false)", userID); err != nil {
			conn.Release()
			return nil, fmt.Errorf("set RLS context: %w", err)
		}
	}

	return &Conn{conn}, nil
}
