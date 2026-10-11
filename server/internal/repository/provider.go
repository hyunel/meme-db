package repository

import (
	"context"

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
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(NewRepos(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
