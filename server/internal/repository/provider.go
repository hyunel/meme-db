package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Provider manages database connections.
// It embeds Repos for direct pool-based access (no RLS),
// and provides Conn/Tx methods for RLS-enabled operations.
type Provider struct {
	*Repos // Embedded for direct access without RLS
	pool   *pgxpool.Pool
}

func NewProvider(pool *pgxpool.Pool) *Provider {
	return &Provider{
		Repos: NewRepos(pool),
		pool:  pool,
	}
}

// Pool returns the underlying connection pool.
func (p *Provider) Pool() *pgxpool.Pool { return p.pool }

// Conn acquires a connection with RLS context. Caller MUST call release().
func (p *Provider) Conn(ctx context.Context, userID string) (*Repos, func(), error) {
	conn, err := db.Acquire(ctx, p.pool, userID)
	if err != nil {
		return nil, nil, err
	}
	return NewRepos(conn), conn.Release, nil
}

// Tx executes fn within a transaction with RLS context.
func (p *Provider) Tx(ctx context.Context, userID string, fn func(*Repos) error) error {
	conn, err := db.Acquire(ctx, p.pool, userID)
	if err != nil {
		return err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(NewRepos(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TxNoRLS executes fn within a transaction without RLS context.
// Use this for system-level operations that don't require user context.
func (p *Provider) TxNoRLS(ctx context.Context, fn func(*Repos) error) error {
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
