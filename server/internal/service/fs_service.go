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
	repo         *repository.Provider
	memeService  *MemeService
	assetService *AssetService
}

func NewFileSystemService(repo *repository.Provider, memeService *MemeService, assetService *AssetService) *FileSystemService {
	return &FileSystemService{
		repo:         repo,
		memeService:  memeService,
		assetService: assetService,
	}
}

func (s *FileSystemService) populateNodeURL(node *model.Node) {
	if node.Type == model.NodeTypeFile && node.AssetID != nil {
		node.URL = s.assetService.GetAssetURL(*node.AssetID)
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
	s.populateNodeURL(node)
	return node, nil
}

type GetNodeResponse struct {
	Node        *model.Node   `json:"node"`
	Children    []*model.Node `json:"children"`
	Breadcrumbs []*model.Node `json:"breadcrumbs"`
}

func (s *FileSystemService) GetNode(ctx context.Context, id string, ownerID string) (*GetNodeResponse, error) {
	var node *model.Node
	var breadcrumbs []*model.Node
	var children []*model.Node

	if id != "" {
		var err error
		node, err = s.repo.Node.GetNode(ctx, id, ownerID)
		if err != nil {
			return nil, apperror.NotFound("node not found")
		}

		// Breadcrumbs
		breadcrumbs, _ = s.repo.Node.GetAncestors(ctx, node.Path)
		for _, n := range breadcrumbs {
			s.populateNodeURL(n)
		}

		// Children
		if node.Type == model.NodeTypeFolder {
			children, _ = s.repo.Node.ListNodes(ctx, &node.ID, ownerID)
		}
		s.populateNodeURL(node)
	} else {
		// Root
		children, _ = s.repo.Node.ListNodes(ctx, nil, ownerID)
	}

	for _, n := range children {
		s.populateNodeURL(n)
	}

	if breadcrumbs == nil {
		breadcrumbs = []*model.Node{}
	}
	if children == nil {
		children = []*model.Node{}
	}

	return &GetNodeResponse{
		Node:        node,
		Children:    children,
		Breadcrumbs: breadcrumbs,
	}, nil
}

type UpdateNodeInput struct {
	Name       *string
	Visibility *model.Visibility
	IsFavorite *bool
}

func (s *FileSystemService) UpdateNode(ctx context.Context, id string, ownerID string, input UpdateNodeInput) (*model.Node, error) {
	node, err := s.repo.Node.GetNode(ctx, id, ownerID)
	if err != nil {
		return nil, apperror.NotFound("node not found")
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
	s.populateNodeURL(node)
	return node, nil
}

func (s *FileSystemService) BulkDeleteNodes(ctx context.Context, ownerID string, ids []string) error {
	return s.repo.Transaction(ctx, func(txRepo *repository.Repositories) error {
		for _, id := range ids {
			if err := txRepo.Node.DeleteNode(ctx, id, ownerID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) BulkMoveNodes(ctx context.Context, ownerID string, ids []string, destParentID *string) error {
	var destNode *model.Node
	if destParentID != nil {
		var err error
		destNode, err = s.repo.Node.GetNode(ctx, *destParentID, ownerID)
		if err != nil {
			return apperror.NotFound("destination parent not found")
		}
	}

	nodes, err := s.repo.Node.GetNodes(ctx, ids, ownerID)
	if err != nil {
		return err
	}

	if err := s.checkForCycles(nodes, destNode); err != nil {
		return err
	}

	destPath := ""
	if destNode != nil {
		destPath = destNode.Path
	}

	return s.repo.Transaction(ctx, func(txRepo *repository.Repositories) error {
		for _, node := range nodes {
			newPath := strings.ReplaceAll(node.ID, "-", "")
			if destPath != "" {
				newPath = destPath + "." + newPath
			}

			if err := txRepo.Node.MoveNode(ctx, node.ID, destParentID, newPath, ownerID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) BulkCopyNodes(ctx context.Context, ownerID string, ids []string, destParentID string) error {
	destNode, err := s.repo.Node.GetNode(ctx, destParentID, ownerID)
	if err != nil {
		return apperror.NotFound("destination parent not found")
	}

	nodes, err := s.repo.Node.GetNodes(ctx, ids, ownerID)
	if err != nil {
		return err
	}

	if err := s.checkForCycles(nodes, destNode); err != nil {
		return err
	}

	return s.repo.Transaction(ctx, func(txRepo *repository.Repositories) error {
		for _, node := range nodes {
			if _, err := s.recursiveCopy(ctx, txRepo, node, &destParentID, ownerID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) recursiveCopy(ctx context.Context, txRepo *repository.Repositories, sourceNode *model.Node, newParentID *string, ownerID string) (*model.Node, error) {
	newName := ""
	if sourceNode.Name != "" {
		newName = sourceNode.Name + " (Copy)"
	}

	newNode := &model.Node{
		OwnerID:    ownerID,
		ParentID:   newParentID,
		Name:       newName,
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

func (s *FileSystemService) checkForCycles(nodes []*model.Node, destNode *model.Node) error {
	if destNode == nil {
		return nil
	}

	for _, node := range nodes {
		// Cycle exists if destNode.Path == node.Path OR destNode.Path starts with node.Path + "."
		if destNode.Path == node.Path || strings.HasPrefix(destNode.Path, node.Path+".") {
			return apperror.BadRequest("cannot move or copy a folder into itself or its descendants")
		}
	}

	return nil
}

func (s *FileSystemService) UploadMeme(ctx context.Context, ownerID string, parentID *string, fileHeader *multipart.FileHeader) (*model.Node, error) {
	asset, err := s.assetService.CreateAsset(ctx, fileHeader)
	if err != nil {
		return nil, err
	}

	node := &model.Node{
		OwnerID:    ownerID,
		ParentID:   parentID,
		Name:       "", // Intentionally left blank
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPriv,
		AssetID:    &asset.ID,
	}

	if err := s.repo.Node.CreateNode(ctx, node); err != nil {
		return nil, err
	}
	s.populateNodeURL(node)
	return node, nil
}

func (s *FileSystemService) GetAssetForContent(ctx context.Context, assetID string, token string) (*model.Asset, error) {
	if err := s.assetService.VerifyAccessToken(assetID, token); err != nil {
		return nil, apperror.Unauthorized(err.Error())
	}

	asset, err := s.repo.Asset.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if asset == nil {
		return nil, apperror.NotFound("asset not found")
	}

	return asset, nil
}
