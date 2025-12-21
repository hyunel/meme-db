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

type MemeRepo interface {
	CreateMeme(ctx context.Context, meme *model.MemeInfo) error
	SearchByVector(ctx context.Context, vectorColumn string, queryVector pgvector.Vector, limit int, scope string, ownerID string, folderPath *string) ([]SearchResult, error)
	SearchByOCR(ctx context.Context, textQuery string, limit int, scope string, ownerID string, folderPath *string) ([]SearchResult, error)
	GetMeme(ctx context.Context, assetID string) (*model.MemeInfo, error)
	CountMemes(ctx context.Context) (int64, error)
	CountMemesMissingEmbeddings(ctx context.Context) (int64, error)
	GetPendingMemesForUpdate(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error)
}

type TaskRepo interface {
	CreateTask(ctx context.Context, jobType string, payload interface{}) (*model.Task, error)
	CreateTaskWithOpts(ctx context.Context, jobType string, payload interface{}, opts *TaskOpts) (*model.Task, error)
	GetNextPendingTask(ctx context.Context) (*model.Task, error)
	UpdateTaskStatus(ctx context.Context, id string, status string, errorMessage *string) error
	CreateHistoryFromTask(ctx context.Context, taskID string, historyStatus string, finishedAt *time.Time, errorMessage *string) error
	ResetTask(ctx context.Context, taskID string, runAt time.Time, taskContext interface{}) error
	ResetStaleTasks(ctx context.Context, duration time.Duration) error
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
	CreateTag(ctx context.Context, name string, scope model.TagScope) (*model.Tag, error)
	GetTag(ctx context.Context, id string) (*model.Tag, error)
	ListTags(ctx context.Context, scope *model.TagScope) ([]*model.Tag, error)
	UpdateTag(ctx context.Context, id string, name string) (*model.Tag, error)
	DeleteTag(ctx context.Context, id string) error
	AddTagToNode(ctx context.Context, nodeID string, tagID string) error
	RemoveTagFromNode(ctx context.Context, nodeID string, tagID string) error
	GetNodeTags(ctx context.Context, nodeID string) ([]*model.Tag, error)
}
