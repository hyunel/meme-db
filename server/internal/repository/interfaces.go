package repository

import (
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/pgvector/pgvector-go"
)

// Repos provides access to all repositories.
// Created per-request with RLS context already set.
type Repos struct {
	User     *UserRepository
	Meme     *MemeRepository
	Asset    *AssetRepository
	Task     *TaskRepository
	Node     *NodeRepository
	Tag      *TagRepository
	Favorite *FavoriteRepository
}

// NewRepos creates a new Repos instance with the given database connection.
func NewRepos(db db.DBTX) *Repos {
	return &Repos{
		User:     &UserRepository{db: db},
		Meme:     &MemeRepository{db: db},
		Asset:    &AssetRepository{db: db},
		Task:     &TaskRepository{db: db},
		Node:     &NodeRepository{db: db},
		Tag:      &TagRepository{db: db},
		Favorite: &FavoriteRepository{db: db},
	}
}

// ==============================================================================
// Search Types
// ==============================================================================

type RecallConfig[T any] struct {
	Enabled   bool
	Value     T
	Threshold float32
	Limit     int
}

type SearchCombinedParams struct {
	Metaphor  RecallConfig[pgvector.Vector]
	Semantic  RecallConfig[pgvector.Vector]
	ClipText  RecallConfig[pgvector.Vector]
	ClipImage RecallConfig[pgvector.Vector]
	OCR       RecallConfig[string]

	Scope      string  // "my" for user's library only, empty for global
	FolderPath *string // Optional folder path filter
}

type SearchSimilarParams struct {
	SourceAssetID string
	Metaphor      RecallConfig[pgvector.Vector]
	Semantic      RecallConfig[pgvector.Vector]
	Clip          RecallConfig[pgvector.Vector]
}

type TaskOpts struct {
	OwnerID  *string
	Priority int
	RunAt    time.Time
	Cron     *string
}
