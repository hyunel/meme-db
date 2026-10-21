package db

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxvec "github.com/pgvector/pgvector-go/pgx"
)

func NewDB(url string) (*pgxpool.Pool, error) {
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database config: %w", err)
	}

	// The pool's connections register the vector type, so a new database gains it before they connect.
	conn, err := pgx.ConnectConfig(ctx, config.ConnConfig)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}
	_, err = conn.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS vector`)
	conn.Close(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to create the vector extension: %w", err)
	}

	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if err := pgxvec.RegisterTypes(ctx, conn); err != nil {
			return err
		}
		// Let filtered vector searches keep scanning the HNSW index until LIMIT is met.
		_, err := conn.Exec(ctx, "SET hnsw.iterative_scan = relaxed_order")
		return err
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	slog.Info("Connected to database")
	return pool, nil
}
