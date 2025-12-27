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
	HasAssetAccess(ctx context.Context, assetID string, ownerID string) (bool, error)
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

type MemeRepo interface {
	CreateMeme(ctx context.Context, meme *model.MemeInfo) error
	UpdateMemeStatus(ctx context.Context, assetID string, status string) error
	SearchCombined(ctx context.Context, params SearchCombinedParams) ([]*model.SearchCandidate, error)
	GetMemeViews(ctx context.Context, assetIDs []string, ownerID *string) (map[string]*model.MemeView, error)
	GetPendingMemes(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error)
	ResetMemeStatus(ctx context.Context, assetIDs []string) error
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
	GetTagsByAssets(ctx context.Context, assetIDs []string, userID *string) (map[string][]*model.Tag, error)
	GetAssetsByTag(ctx context.Context, tagID string) ([]*model.Asset, error)
	GetTag(ctx context.Context, tagID string) (*model.Tag, error)
	SearchTags(ctx context.Context, query string) ([]*model.Tag, error)
	CreateTag(ctx context.Context, name string) (*model.Tag, error)
	AddAssetTag(ctx context.Context, assetID, tagID string, userID *string) error
	RemoveAssetTag(ctx context.Context, assetID, tagID string, userID *string) error
}

type FavoriteRepo interface {
	AddAssetFavorite(ctx context.Context, userID string, assetIDs []string) error
	RemoveAssetFavorite(ctx context.Context, userID string, assetIDs []string) error
	AddNodeFavorite(ctx context.Context, userID string, nodeIDs []string) error
	RemoveNodeFavorite(ctx context.Context, userID string, nodeIDs []string) error
	IsAssetFavorite(ctx context.Context, userID, assetID string) (bool, error)
	IsNodeFavorite(ctx context.Context, userID, nodeID string) (bool, error)
	GetFavorites(ctx context.Context, userID string, nodeIDs, assetIDs []string) (map[string]bool, map[string]bool, error)
	ListFavorites(ctx context.Context, userID string) (assetIDs []string, nodeIDs []string, err error)
}
