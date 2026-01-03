package service

import (
	"context"
	"fmt"
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

func (s *FileSystemService) assembleNodeViews(ctx context.Context, r *repository.Repos, nodes []*model.Node) ([]*model.NodeView, error) {
	if len(nodes) == 0 {
		return []*model.NodeView{}, nil
	}

	var assetIDs, nodeIDs []string
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
		memeMap, err = s.memeService.getMemeViews(ctx, r, assetIDs)
		if err != nil {
			return nil, err
		}
	}

	// Fetch Favorites
	nodeFavs, assetFavs, err := r.Favorite.GetStatus(ctx, nodeIDs, assetIDs)
	if err != nil {
		return nil, err
	}

	views := make([]*model.NodeView, len(nodes))
	for i, n := range nodes {
		view := &model.NodeView{Node: n}

		if n.Type == model.NodeTypeFolder {
			view.IsFavorite = nodeFavs[n.ID]
		} else if n.AssetID != nil {
			view.IsFavorite = assetFavs[*n.AssetID]
		}

		if n.AssetID != nil && memeMap != nil {
			if meme, ok := memeMap[*n.AssetID]; ok {
				meme.IsFavorite = assetFavs[*n.AssetID]
				view.Meme = meme
			}
		}
		views[i] = view
	}

	return views, nil
}

func (s *FileSystemService) CreateNode(ctx context.Context, userID string, parentID *string, name string, nodeType model.NodeType) (*model.NodeView, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	node := &model.Node{
		ParentID:   parentID,
		Name:       name,
		Type:       nodeType,
		Visibility: model.VisibilityPrivate,
	}

	if err := r.Node.Create(ctx, node); err != nil {
		return nil, err
	}

	freshNode, err := r.Node.Get(ctx, node.ID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, r, []*model.Node{freshNode})
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

// GetNodeResult contains the data for a node request (assembled in handler as response).
type GetNodeResult struct {
	Node        *model.NodeView
	Children    []*model.NodeView
	Breadcrumbs []*model.NodeView
}

func (s *FileSystemService) GetNode(ctx context.Context, userID string, id string) (*GetNodeResult, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	var nodeView *model.NodeView
	var breadcrumbs, children []*model.NodeView

	if id != "" {
		node, err := r.Node.Get(ctx, id)
		if err != nil {
			return nil, apperror.NotFound("node not found")
		}

		views, err := s.assembleNodeViews(ctx, r, []*model.Node{node})
		if err != nil {
			return nil, err
		}
		nodeView = views[0]

		ancestors, err := r.Node.GetAncestors(ctx, node.Path)
		if err != nil {
			return nil, err
		}
		breadcrumbs, err = s.assembleNodeViews(ctx, r, ancestors)
		if err != nil {
			return nil, err
		}

		if node.Type == model.NodeTypeFolder {
			childNodes, err := r.Node.List(ctx, &node.ID)
			if err != nil {
				return nil, err
			}
			children, err = s.assembleNodeViews(ctx, r, childNodes)
			if err != nil {
				return nil, err
			}
		}
	} else {
		childNodes, err := r.Node.List(ctx, nil)
		if err != nil {
			return nil, err
		}
		children, err = s.assembleNodeViews(ctx, r, childNodes)
		if err != nil {
			return nil, err
		}
	}

	if breadcrumbs == nil {
		breadcrumbs = []*model.NodeView{}
	}
	if children == nil {
		children = []*model.NodeView{}
	}

	return &GetNodeResult{
		Node:        nodeView,
		Children:    children,
		Breadcrumbs: breadcrumbs,
	}, nil
}

type BulkUpdateNodeInput struct {
	ID         string
	Name       *string
	Visibility *model.Visibility
}

func (s *FileSystemService) BulkUpdateNodes(ctx context.Context, userID string, inputs []BulkUpdateNodeInput) ([]*model.NodeView, error) {
	var nodes []*model.Node

	err := s.repo.Tx(ctx, userID, func(r *repository.Repos) error {
		for _, input := range inputs {
			node, err := r.Node.Get(ctx, input.ID)
			if err != nil {
				return apperror.NotFound(fmt.Sprintf("node %s not found", input.ID))
			}

			if input.Name != nil {
				node.Name = *input.Name
			}
			if input.Visibility != nil {
				node.Visibility = *input.Visibility
			}

			if err := r.Node.Update(ctx, node); err != nil {
				return err
			}

			freshNode, err := r.Node.Get(ctx, node.ID)
			if err != nil {
				return err
			}
			nodes = append(nodes, freshNode)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	return s.assembleNodeViews(ctx, r, nodes)
}

func (s *FileSystemService) BulkDeleteNodes(ctx context.Context, userID string, ids []string) error {
	return s.repo.Tx(ctx, userID, func(r *repository.Repos) error {
		for _, id := range ids {
			if err := r.Node.Delete(ctx, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) BulkMoveNodes(ctx context.Context, userID string, ids []string, destParentID *string) error {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

	var destNode *model.Node
	if destParentID != nil {
		destNode, err = r.Node.Get(ctx, *destParentID)
		if err != nil {
			return apperror.NotFound("destination parent not found")
		}
	}

	nodes, err := r.Node.GetMany(ctx, ids)
	if err != nil {
		return err
	}

	if err := checkForCycles(nodes, destNode); err != nil {
		return err
	}

	destPath := ""
	if destNode != nil {
		destPath = destNode.Path
	}

	return s.repo.Tx(ctx, userID, func(txR *repository.Repos) error {
		for _, node := range nodes {
			newPath := strings.ReplaceAll(node.ID, "-", "")
			if destPath != "" {
				newPath = destPath + "." + newPath
			}
			if err := txR.Node.Move(ctx, node.ID, destParentID, newPath); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileSystemService) BulkCopyNodes(ctx context.Context, userID string, ids []string, destParentID *string) error {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

	var destNode *model.Node
	if destParentID != nil {
		destNode, err = r.Node.Get(ctx, *destParentID)
		if err != nil {
			return apperror.NotFound("destination parent not found")
		}
	}

	nodes, err := r.Node.GetMany(ctx, ids)
	if err != nil {
		return err
	}

	if err := checkForCycles(nodes, destNode); err != nil {
		return err
	}

	return s.repo.Tx(ctx, userID, func(txR *repository.Repos) error {
		for _, node := range nodes {
			if _, err := recursiveCopy(ctx, txR, node, destParentID); err != nil {
				return err
			}
		}
		return nil
	})
}

func recursiveCopy(ctx context.Context, r *repository.Repos, sourceNode *model.Node, newParentID *string) (*model.Node, error) {
	newNode := &model.Node{
		ParentID:   newParentID,
		Name:       sourceNode.Name,
		Type:       sourceNode.Type,
		Visibility: sourceNode.Visibility,
		AssetID:    sourceNode.AssetID,
	}
	if err := r.Node.Create(ctx, newNode); err != nil {
		return nil, err
	}

	if sourceNode.Type == model.NodeTypeFolder {
		children, err := r.Node.List(ctx, &sourceNode.ID)
		if err != nil {
			return nil, err
		}
		for _, child := range children {
			if _, err := recursiveCopy(ctx, r, child, &newNode.ID); err != nil {
				return nil, err
			}
		}
	}

	return newNode, nil
}

func checkForCycles(nodes []*model.Node, destNode *model.Node) error {
	if destNode == nil {
		return nil
	}
	for _, node := range nodes {
		if destNode.Path == node.Path || strings.HasPrefix(destNode.Path, node.Path+".") {
			return apperror.BadRequest("cannot move or copy a folder into itself or its descendants")
		}
	}
	return nil
}

func (s *FileSystemService) UploadMeme(ctx context.Context, userID string, parentID *string, fileHeader *multipart.FileHeader) (*model.NodeView, error) {
	asset, err := s.assetService.CreateAsset(ctx, fileHeader)
	if err != nil {
		return nil, err
	}

	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	node := &model.Node{
		ParentID:   parentID,
		Name:       fileHeader.Filename,
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPrivate,
		AssetID:    &asset.ID,
	}

	if err := r.Node.Create(ctx, node); err != nil {
		return nil, err
	}

	freshNode, err := r.Node.Get(ctx, node.ID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, r, []*model.Node{freshNode})
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

func (s *FileSystemService) AddAssetToRoot(ctx context.Context, userID string, assetID string) (*model.NodeView, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	exists, err := r.Asset.HasAccess(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, apperror.Forbidden("you do not have permission to access this asset")
	}

	node := &model.Node{
		ParentID:   nil,
		Name:       "",
		Type:       model.NodeTypeFile,
		Visibility: model.VisibilityPrivate,
		AssetID:    &assetID,
	}

	if err := r.Node.Create(ctx, node); err != nil {
		return nil, err
	}

	freshNode, err := r.Node.Get(ctx, node.ID)
	if err != nil {
		return nil, err
	}

	views, err := s.assembleNodeViews(ctx, r, []*model.Node{freshNode})
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

func (s *FileSystemService) GetAssetForContent(ctx context.Context, assetID string, token string) (*model.Asset, error) {
	if err := s.assetService.VerifyAccessToken(assetID, token); err != nil {
		return nil, apperror.Unauthorized(err.Error())
	}

	asset, err := s.repo.Asset.Get(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if asset == nil {
		return nil, apperror.NotFound("asset not found")
	}

	return asset, nil
}
