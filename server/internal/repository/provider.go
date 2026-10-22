package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Provider struct {
	*Repos
	pool *pgxpool.Pool
}

func NewProvider(pool *pgxpool.Pool) *Provider {
	return &Provider{
		Repos: NewRepos(pool),
		pool:  pool,
	}
}

func (p *Provider) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

func (p *Provider) Tx(ctx context.Context, fn func(*Repos) error) error {
	return p.tx(ctx, pgx.TxOptions{}, fn)
}

// Snapshot runs fn in a read-only transaction that sees the database as it was when it began.
func (p *Provider) Snapshot(ctx context.Context, fn func(*Repos) error) error {
	return p.tx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, fn)
}

func (p *Provider) tx(ctx context.Context, opts pgx.TxOptions, fn func(*Repos) error) error {
	tx, err := p.pool.BeginTx(ctx, opts)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(NewRepos(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Provider) Migrate(ctx context.Context, to int) error {
	return db.Migrate(ctx, p.pool, to)
}

func (p *Provider) SchemaVersion(ctx context.Context) (int, error) {
	return db.SchemaVersion(ctx, p.pool)
}
