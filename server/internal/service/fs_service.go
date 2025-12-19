package service

import (
	"context"
	"mime/multipart"
	"strings"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type FileSystemService struct {
	repo        *repository.Provider
	memeService *MemeService
}

func NewFileSystemService(repo *repository.Provider, memeService *MemeService) *FileSystemService {
	return &FileSystemService{
		repo:        repo,
		memeService: memeService,
	}
}

func (s *FileSystemService) CreateNode(ctx context.Context, ownerID string, parentID *string, name string, nodeType model.NodeType) (*model.Node, error) {
	node := &model.Node{
		OwnerID:    ownerID,
		ParentID:   parentID,
		Name:       name,
		Type:       nodeType,
		Visibility: model.VisibilityPriv,
	}

	if err := s.repo.Node.CreateNode(ctx, node); err != nil {
		return nil, err
	}
	return node, nil
}

func (s *FileSystemService) GetNode(ctx context.Context, id string) (*model.Node, error) {
	node, err := s.repo.Node.GetNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, apperror.NotFound("node not found")
	}
	return node, nil
}

func (s *FileSystemService) ListChildren(ctx context.Context, id string, ownerID string) ([]*model.Node, error) {
	return s.repo.Node.ListNodes(ctx, &id, ownerID)
}

type UpdateNodeInput struct {
	Name       *string
	Visibility *model.Visibility
	IsFavorite *bool
}

func (s *FileSystemService) UpdateNode(ctx context.Context, id string, ownerID string, input UpdateNodeInput) (*model.Node, error) {
	node, err := s.repo.Node.GetNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, apperror.NotFound("node not found")
	}
	if node.OwnerID != ownerID {
		return nil, apperror.Forbidden("permission denied")
	}

	// Root node check (optional, but good for safety)
	if node.ParentID == nil && input.Name != nil {
		// Prevent renaming root or handle it
	}

	if input.Name != nil {
		node.Name = *input.Name
	}
	if input.Visibility != nil {
		node.Visibility = *input.Visibility
	}
	if input.IsFavorite != nil {
		node.IsFavorite = *input.IsFavorite
	}

	if err := s.repo.Node.UpdateNode(ctx, node); err != nil {
		return nil, err
	}
	return node, nil
}

func (s *FileSystemService) DeleteNode(ctx context.Context, id string, ownerID string) error {
	node, err := s.repo.Node.GetNode(ctx, id)
	if err != nil {
		return err
	}
	if node == nil {
		return apperror.NotFound("node not found")
	}
	if node.OwnerID != ownerID {
		return apperror.Forbidden("permission denied")
	}
	if node.ParentID == nil {
		return apperror.BadRequest("cannot delete root folder")
	}

	return s.repo.Node.RecursiveDelete(ctx, node.Path)
}

func (s *FileSystemService) MoveNode(ctx context.Context, id string, ownerID string, destParentID *string) error {
	node, err := s.repo.Node.GetNode(ctx, id)
	if err != nil {
		return err
	}
	if node == nil {
		return apperror.NotFound("node not found")
	}
	if node.OwnerID != ownerID {
		return apperror.Forbidden("permission denied")
	}
	if node.ParentID == nil {
		return apperror.BadRequest("cannot move root folder")
	}

	// Compute new path
	var newPathPrefix string
	if destParentID != nil {
		destParent, err := s.repo.Node.GetNode(ctx, *destParentID)
		if err != nil {
			return err
		}
		if destParent == nil {
			return apperror.NotFound("destination parent not found")
		}
		if destParent.OwnerID != ownerID {
			return apperror.Forbidden("permission denied for destination")
		}
		newPathPrefix = destParent.Path
	} else {
		// Moving to root is not allowed if we assume only one root
		return apperror.BadRequest("moving to root (nil parent) is not supported")
	}

	newPath := newPathPrefix + "." + strings.ReplaceAll(node.ID, "-", "")
	return s.repo.Node.MoveNode(ctx, id, destParentID, newPath)
}

func (s *FileSystemService) UploadMeme(ctx context.Context, ownerID string, parentID string, fileHeader *multipart.FileHeader) (*model.Node, error) {
	// 1. Ingest asset via MemeService
	asset, err := s.memeService.IngestMeme(ctx, fileHeader)
	if err != nil {
		return nil, err
	}

	// 2. Create Node
	node := &model.Node{
		OwnerID:    ownerID,
		ParentID:   &parentID,
		Name:       fileHeader.Filename,
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPriv,
		AssetID:    &asset.ID,
	}

	if err := s.repo.Node.CreateNode(ctx, node); err != nil {
		return nil, err
	}
	return node, nil
}

func (s *FileSystemService) CopyNode(ctx context.Context, id string, ownerID string, destParentID string) (*model.Node, error) {
	node, err := s.repo.Node.GetNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, apperror.NotFound("node not found")
	}
	if node.OwnerID != ownerID {
		return nil, apperror.Forbidden("permission denied")
	}

	destParent, err := s.repo.Node.GetNode(ctx, destParentID)
	if err != nil {
		return nil, err
	}
	if destParent == nil {
		return nil, apperror.NotFound("destination parent not found")
	}
	if destParent.OwnerID != ownerID {
		return nil, apperror.Forbidden("permission denied for destination")
	}

	// Recursive copy logic in transaction
	var newNode *model.Node
	err = s.repo.Transaction(ctx, func(txRepo *repository.Repositories) error {
		var txErr error
		newNode, txErr = s.recursiveCopy(ctx, txRepo, node, &destParentID, ownerID)
		return txErr
	})

	return newNode, err
}

func (s *FileSystemService) recursiveCopy(ctx context.Context, txRepo *repository.Repositories, sourceNode *model.Node, newParentID *string, ownerID string) (*model.Node, error) {
	// Create current node
	newNode := &model.Node{
		OwnerID:    ownerID,
		ParentID:   newParentID,
		Name:       sourceNode.Name + " (Copy)",
		Type:       sourceNode.Type,
		Visibility: sourceNode.Visibility,
		AssetID:    sourceNode.AssetID,
		IsFavorite: sourceNode.IsFavorite,
	}
	if err := txRepo.Node.CreateNode(ctx, newNode); err != nil {
		return nil, err
	}

	if sourceNode.Type == model.NodeTypeFolder {
		children, err := txRepo.Node.ListNodes(ctx, &sourceNode.ID, ownerID)
		if err != nil {
			return nil, err
		}
		for _, child := range children {
			if _, err := s.recursiveCopy(ctx, txRepo, child, &newNode.ID, ownerID); err != nil {
				return nil, err
			}
		}
	}

	return newNode, nil
}
