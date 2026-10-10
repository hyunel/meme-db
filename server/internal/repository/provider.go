package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Provider gives services access to the repositories.
// The embedded Repos run on the pool; Tx runs a function on a transaction.
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

// Ping checks the database connection.
func (p *Provider) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// Tx executes fn within a transaction.
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
