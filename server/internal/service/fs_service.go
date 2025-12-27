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

func (s *FileSystemService) assembleNodeViews(ctx context.Context, nodes []*model.Node, ownerID string) ([]*model.NodeView, error) {
	if len(nodes) == 0 {
		return []*model.NodeView{}, nil
	}

	var assetIDs []string
	var nodeIDs []string
	for _, n := range nodes {
		nodeIDs = append(nodeIDs, n.ID)
		if n.AssetID != nil {
			assetIDs = append(assetIDs, *n.AssetID)
		}
	}

	// Fetch Meme Views
	var memeMap map[string]*model.MemeView
	if len(assetIDs) > 0 {
		var err error
		memeMap, err = s.memeService.GetMemeViews(ctx, assetIDs, ownerID)
		if err != nil {
			return nil, err
		}
	}

	// Fetch Favorites
	nodeFavs, assetFavs, err := s.repo.Favorite.GetFavorites(ctx, ownerID, nodeIDs, assetIDs)
	if err != nil {
		return nil, err
	}

	views := make([]*model.NodeView, len(nodes))
	for i, n := range nodes {
		view := &model.NodeView{
			Node: n,
		}

		// Set Favorite Status
		if n.Type == model.NodeTypeFolder {
			view.IsFavorite = nodeFavs[n.ID]
		} else if n.AssetID != nil {
			view.IsFavorite = assetFavs[*n.AssetID]
		}

		// Attach Meme Info
		if n.AssetID != nil && memeMap != nil {
			if meme, ok := memeMap[*n.AssetID]; ok {
				// Also update meme view favorite status for consistency
				meme.IsFavorite = assetFavs[*n.AssetID]
				view.Meme = meme
			}
		}
		views[i] = view
	}

	return views, nil
}

func (s *FileSystemService) CreateNode(ctx context.Context, ownerID string, parentID *string, name string, nodeType model.NodeType) (*model.NodeView, error) {
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

	// Fetch fresh node to be sure
	freshNode, err := s.repo.Node.GetNode(ctx, node.ID, ownerID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, []*model.Node{freshNode}, ownerID)
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

type GetNodeResponse struct {
	Node        *model.NodeView   `json:"node"`
	Children    []*model.NodeView `json:"children"`
	Breadcrumbs []*model.NodeView `json:"breadcrumbs"`
}

func (s *FileSystemService) GetNode(ctx context.Context, id string, ownerID string) (*GetNodeResponse, error) {
	var nodeView *model.NodeView
	var breadcrumbs []*model.NodeView
	var children []*model.NodeView

	if id != "" {
		node, err := s.repo.Node.GetNode(ctx, id, ownerID)
		if err != nil {
			return nil, apperror.NotFound("node not found")
		}

		views, err := s.assembleNodeViews(ctx, []*model.Node{node}, ownerID)
		if err != nil {
			return nil, err
		}
		nodeView = views[0]

		// Breadcrumbs
		ancestors, err := s.repo.Node.GetAncestors(ctx, node.Path)
		if err != nil {
			return nil, err
		}
		breadcrumbs, err = s.assembleNodeViews(ctx, ancestors, ownerID)
		if err != nil {
			return nil, err
		}

		// Children
		if node.Type == model.NodeTypeFolder {
			childNodes, err := s.repo.Node.ListNodes(ctx, &node.ID, ownerID)
			if err != nil {
				return nil, err
			}
			children, err = s.assembleNodeViews(ctx, childNodes, ownerID)
			if err != nil {
				return nil, err
			}
		}
	} else {
		// Root
		childNodes, err := s.repo.Node.ListNodes(ctx, nil, ownerID)
		if err != nil {
			return nil, err
		}
		var err2 error
		children, err2 = s.assembleNodeViews(ctx, childNodes, ownerID)
		if err2 != nil {
			return nil, err2
		}
	}

	if breadcrumbs == nil {
		breadcrumbs = []*model.NodeView{}
	}
	if children == nil {
		children = []*model.NodeView{}
	}

	return &GetNodeResponse{
		Node:        nodeView,
		Children:    children,
		Breadcrumbs: breadcrumbs,
	}, nil
}

type UpdateNodeInput struct {
	Name       *string
	Visibility *model.Visibility
	IsFavorite *bool
}

func (s *FileSystemService) UpdateNode(ctx context.Context, id string, ownerID string, input UpdateNodeInput) (*model.NodeView, error) {
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

	if err := s.repo.Node.UpdateNode(ctx, node); err != nil {
		return nil, err
	}

	// Fetch fresh to reflect updates
	freshNode, err := s.repo.Node.GetNode(ctx, id, ownerID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, []*model.Node{freshNode}, ownerID)
	if err != nil {
		return nil, err
	}
	return views[0], nil
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

func (s *FileSystemService) BulkCopyNodes(ctx context.Context, ownerID string, ids []string, destParentID *string) error {
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

	return s.repo.Transaction(ctx, func(txRepo *repository.Repositories) error {
		for _, node := range nodes {
			if _, err := s.recursiveCopy(ctx, txRepo, node, destParentID, ownerID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) recursiveCopy(ctx context.Context, txRepo *repository.Repositories, sourceNode *model.Node, newParentID *string, ownerID string) (*model.Node, error) {
	newNode := &model.Node{
		OwnerID:    ownerID,
		ParentID:   newParentID,
		Name:       sourceNode.Name,
		Type:       sourceNode.Type,
		Visibility: sourceNode.Visibility,
		AssetID:    sourceNode.AssetID,
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

func (s *FileSystemService) UploadMeme(ctx context.Context, ownerID string, parentID *string, fileHeader *multipart.FileHeader) (*model.NodeView, error) {
	asset, err := s.assetService.CreateAsset(ctx, fileHeader)
	if err != nil {
		return nil, err
	}

	node := &model.Node{
		OwnerID:    ownerID,
		ParentID:   parentID,
		Name:       fileHeader.Filename,
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPriv,
		AssetID:    &asset.ID,
	}

	if err := s.repo.Node.CreateNode(ctx, node); err != nil {
		return nil, err
	}

	// Fetch fresh node
	freshNode, err := s.repo.Node.GetNode(ctx, node.ID, ownerID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, []*model.Node{freshNode}, ownerID)
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

func (s *FileSystemService) AddAssetToRoot(ctx context.Context, ownerID string, assetID string) (*model.NodeView, error) {
	exists, err := s.repo.Asset.HasAssetAccess(ctx, assetID, ownerID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, apperror.Forbidden("you do not have permission to access this asset")
	}

	node := &model.Node{
		OwnerID:    ownerID,
		ParentID:   nil,
		Name:       "",
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPriv,
		AssetID:    &assetID,
	}

	if err := s.repo.Node.CreateNode(ctx, node); err != nil {
		return nil, err
	}

	// Fetch fresh node
	freshNode, err := s.repo.Node.GetNode(ctx, node.ID, ownerID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, []*model.Node{freshNode}, ownerID)
	if err != nil {
		return nil, err
	}
	return views[0], nil
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
