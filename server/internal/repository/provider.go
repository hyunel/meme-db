package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repositories holds all repository interfaces.
type Repositories struct {
	User  UserRepo
	Meme  MemeRepo
	Asset AssetRepo
	Task  TaskRepo
	Node  NodeRepo
	Tag   TagRepo
}

// Provider manages repositories and transactions.
// It embeds Repositories to allow direct access to pool-based repos.
type Provider struct {
	Repositories
	pool *pgxpool.Pool
}

// NewProvider creates a new Provider with pool-based repositories.
func NewProvider(pool *pgxpool.Pool) *Provider {
	return &Provider{
		Repositories: Repositories{
			User:  NewUserRepository(pool),
			Meme:  NewMemeRepository(pool),
			Asset: NewAssetRepository(pool),
			Task:  NewTaskRepository(pool),
			Node:  NewNodeRepository(pool),
			Tag:   NewTagRepository(pool),
		},
		pool: pool,
	}
}

// Transaction executes a function within a database transaction.
func (p *Provider) Transaction(ctx context.Context, fn func(*Repositories) error) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Create a new set of repositories bound to the transaction
	txRepos := &Repositories{
		User:  NewUserRepository(tx),
		Meme:  NewMemeRepository(tx),
		Asset: NewAssetRepository(tx),
		Task:  NewTaskRepository(tx),
		Node:  NewNodeRepository(tx),
		Tag:   NewTagRepository(tx),
	}

	if err := fn(txRepos); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// Interface check
func _(db db.DBTX) {
	// Ensure Repositories can be constructed with DBTX
	// This function is just for compilation checking if we mess up constructors
}
