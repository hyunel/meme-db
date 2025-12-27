package service

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type FavoriteService struct {
	repo         *repository.Provider
	memeService  *MemeService
	assetService *AssetService
}

func NewFavoriteService(repo *repository.Provider, memeService *MemeService, assetService *AssetService) *FavoriteService {
	return &FavoriteService{
		repo:         repo,
		memeService:  memeService,
		assetService: assetService,
	}
}

type FavoriteTargetType string

const (
	FavoriteTargetMeme   FavoriteTargetType = "MEME"
	FavoriteTargetFolder FavoriteTargetType = "FOLDER"
)

type FavoriteToggleItem struct {
	TargetID   string             `json:"id" validate:"required"`
	TargetType FavoriteTargetType `json:"type" validate:"required,oneof=MEME FOLDER"`
	IsFavorite bool               `json:"favorite"`
}

func (s *FavoriteService) ToggleFavorite(ctx context.Context, userID string, items []FavoriteToggleItem) error {
	if len(items) == 0 {
		return nil
	}

	// Group by Type and Favorite status to minimize DB calls
	type key struct {
		TargetType FavoriteTargetType
		IsFavorite bool
	}
	groups := make(map[key][]string)
	for _, item := range items {
		k := key{item.TargetType, item.IsFavorite}
		groups[k] = append(groups[k], item.TargetID)
	}

	for k, targetIDs := range groups {
		switch k.TargetType {
		case FavoriteTargetMeme:
			// Check access to assets
			for _, id := range targetIDs {
				exists, err := s.repo.Asset.HasAssetAccess(ctx, id, userID)
				if err != nil {
					return err
				}
				if !exists {
					return apperror.Forbidden(fmt.Sprintf("you do not have access to meme %s", id))
				}
			}

			if k.IsFavorite {
				if err := s.repo.Favorite.AddAssetFavorite(ctx, userID, targetIDs); err != nil {
					return err
				}
			} else {
				if err := s.repo.Favorite.RemoveAssetFavorite(ctx, userID, targetIDs); err != nil {
					return err
				}
			}

		case FavoriteTargetFolder:
			// Check nodes exist and are folders
			for _, id := range targetIDs {
				node, err := s.repo.Node.GetNode(ctx, id, userID)
				if err != nil {
					return apperror.NotFound(fmt.Sprintf("folder %s not found", id))
				}
				if node.Type != model.NodeTypeFolder {
					return apperror.BadRequest(fmt.Sprintf("node %s is not a folder", id))
				}
			}

			if k.IsFavorite {
				if err := s.repo.Favorite.AddNodeFavorite(ctx, userID, targetIDs); err != nil {
					return err
				}
			} else {
				if err := s.repo.Favorite.RemoveNodeFavorite(ctx, userID, targetIDs); err != nil {
					return err
				}
			}

		default:
			return apperror.BadRequest("invalid favorite target type")
		}
	}

	return nil
}

type ListFavoritesResponse struct {
	Memes   []*model.MemeView `json:"memes"`
	Folders []*model.NodeView `json:"folders"`
}

func (s *FavoriteService) ListFavorites(ctx context.Context, userID string) (*ListFavoritesResponse, error) {
	// 1. Get favorite IDs from repo
	assetIDs, nodeIDs, err := s.repo.Favorite.ListFavorites(ctx, userID)
	if err != nil {
		return nil, err
	}

	res := &ListFavoritesResponse{
		Memes:   []*model.MemeView{},
		Folders: []*model.NodeView{},
	}

	// 2. Fetch Meme Views
	if len(assetIDs) > 0 {
		memes, err := s.memeService.GetMemeViews(ctx, assetIDs, userID)
		if err != nil {
			return nil, err
		}
		for _, id := range assetIDs {
			if m, ok := memes[id]; ok {
				res.Memes = append(res.Memes, m)
			}
		}
	}

	// 3. Fetch Folder Nodes
	if len(nodeIDs) > 0 {
		nodes, err := s.repo.Node.GetNodes(ctx, nodeIDs, userID)
		if err != nil {
			return nil, err
		}
		for _, n := range nodes {
			res.Folders = append(res.Folders, &model.NodeView{
				Node:       n,
				IsFavorite: true,
			})
		}
	}

	return res, nil
}
