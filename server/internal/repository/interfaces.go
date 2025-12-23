package repository

import (
	"context"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/pgvector/pgvector-go"
)

type AssetRepo interface {
	CreateAsset(ctx context.Context, asset *model.Asset) error
	GetAsset(ctx context.Context, id string) (*model.Asset, error)
	GetAssetByHash(ctx context.Context, hash string) (*model.Asset, error)
}

type RecallConfig[T any] struct {
	Enabled   bool
	Value     T
	Threshold float32
	Limit     int
}

type SearchCombinedParams struct {
	Metaphor RecallConfig[pgvector.Vector]
	Semantic RecallConfig[pgvector.Vector]
	Clip     RecallConfig[pgvector.Vector]
	OCR      RecallConfig[string]

	Scope      string
	OwnerID    string
	FolderPath *string
}

type SearchResult struct {
	model.MemeInfo
	Similarity float32 `json:"similarity"`
	RecallType string  `json:"recall_type"`
}

type MemeRepo interface {
	CreateMeme(ctx context.Context, meme *model.MemeInfo) error
	SearchCombined(ctx context.Context, params SearchCombinedParams) ([]SearchResult, error)
	GetMemeDTOs(ctx context.Context, assetIDs []string, ownerID string) (map[string]*model.MemeDTO, error)
	GetPendingMemes(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error)
}

type TaskRepo interface {
	CreateTask(ctx context.Context, jobType string, payload interface{}) (*model.Task, error)
	CreateTaskWithOpts(ctx context.Context, jobType string, payload interface{}, opts *TaskOpts) (*model.Task, error)
	GetNextPendingTask(ctx context.Context) (*model.Task, error)
	UpdateTaskStatus(ctx context.Context, id string, status string, errorMessage *string) error
	CreateHistoryFromTask(ctx context.Context, taskID string, historyStatus string, finishedAt *time.Time, errorMessage *string) error
	ResetTask(ctx context.Context, taskID string, runAt time.Time, taskContext interface{}) error
}

type UserRepo interface {
	CreateUser(ctx context.Context, username, email, passwordHash string) (*model.User, error)
	GetUser(ctx context.Context, id string) (*model.User, error)
	GetByUsername(ctx context.Context, username string) (*model.User, error)
	GetByEmail(ctx context.Context, email string) (*model.User, error)
}

type NodeRepo interface {
	CreateNode(ctx context.Context, node *model.Node) error
	GetNode(ctx context.Context, id string, ownerID string) (*model.Node, error)
	GetNodes(ctx context.Context, ids []string, ownerID string) ([]*model.Node, error)
	ListNodes(ctx context.Context, parentID *string, ownerID string) ([]*model.Node, error)
	UpdateNode(ctx context.Context, node *model.Node) error
	MoveNode(ctx context.Context, id string, newParentID *string, newPath string, ownerID string) error
	DeleteNode(ctx context.Context, id string, ownerID string) error
	GetNodeByPath(ctx context.Context, path string) (*model.Node, error)
	GetSubtree(ctx context.Context, path string) ([]*model.Node, error)
	GetAncestors(ctx context.Context, path string) ([]*model.Node, error)
}

type TagRepo interface {
	GetAssetTags(ctx context.Context, assetID string, userID *string) ([]*model.Tag, error)
	GetAssetsByTag(ctx context.Context, tagID string) ([]*model.Asset, error)
}
