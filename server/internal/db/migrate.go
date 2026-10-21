package db

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The schema is built by these migrations, applied in the order of their numbers. One that has been applied is
// never edited: a change to the schema is a new migration.
//
//go:embed migrations/*.sql
var migrationFS embed.FS

var migrations, _ = migrationFS.ReadDir("migrations") // Sorted by name; an embedded directory always reads

// LatestVersion is the number of the newest migration.
var LatestVersion = len(migrations)

// Migrate applies the migrations after the database's version, up to version to, each with its record in one
// transaction. Servers starting together take turns.
func Migrate(ctx context.Context, pool *pgxpool.Pool, to int) error {
	return locked(ctx, pool, func(conn *pgx.Conn, version int) error {
		for ; version < min(to, LatestVersion); version++ {
			name := migrations[version].Name()
			if n, _, _ := strings.Cut(name, "_"); n != fmt.Sprintf("%04d", version+1) {
				return fmt.Errorf("migration %s is out of sequence", name)
			}
			sql, err := migrationFS.ReadFile("migrations/" + name)
			if err != nil {
				return err
			}
			err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, string(sql)); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `INSERT INTO public.schema_migrations (version) VALUES ($1)`, version+1)
				return err
			})
			if err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			slog.Info("Applied a migration", "migration", name)
		}
		return nil
	})
}

// SchemaVersion returns the number of the newest migration applied, 0 for an empty database.
func SchemaVersion(ctx context.Context, pool *pgxpool.Pool) (version int, err error) {
	err = locked(ctx, pool, func(_ *pgx.Conn, v int) error {
		version = v
		return nil
	})
	return
}

// locked runs fn holding the migrations' lock, with the database's version.
func locked(ctx context.Context, pool *pgxpool.Pool, fn func(conn *pgx.Conn, version int) error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext('schema_migrations'))`); err != nil {
		return err
	}
	defer conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext('schema_migrations'))`)

	_, err = conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version INT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	var version int
	if err := conn.QueryRow(ctx, `SELECT COALESCE(max(version), 0) FROM public.schema_migrations`).Scan(&version); err != nil {
		return err
	}
	if version > LatestVersion {
		return fmt.Errorf("the database's schema is at migration %d, newer than this MemeDB's %d", version, LatestVersion)
	}
	return fn(conn.Conn(), version)
}
