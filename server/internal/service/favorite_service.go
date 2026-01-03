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

	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

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
			for _, id := range targetIDs {
				exists, err := r.Asset.HasAccess(ctx, id)
				if err != nil {
					return err
				}
				if !exists {
					return apperror.Forbidden(fmt.Sprintf("you do not have access to meme %s", id))
				}
			}

			if k.IsFavorite {
				if err := r.Favorite.AddAssets(ctx, targetIDs); err != nil {
					return err
				}
			} else {
				if err := r.Favorite.RemoveAssets(ctx, targetIDs); err != nil {
					return err
				}
			}

		case FavoriteTargetFolder:
			for _, id := range targetIDs {
				node, err := r.Node.Get(ctx, id)
				if err != nil {
					return apperror.NotFound(fmt.Sprintf("folder %s not found", id))
				}
				if node.Type != model.NodeTypeFolder {
					return apperror.BadRequest(fmt.Sprintf("node %s is not a folder", id))
				}
			}

			if k.IsFavorite {
				if err := r.Favorite.AddNodes(ctx, targetIDs); err != nil {
					return err
				}
			} else {
				if err := r.Favorite.RemoveNodes(ctx, targetIDs); err != nil {
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
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	assetIDs, nodeIDs, err := r.Favorite.List(ctx)
	if err != nil {
		return nil, err
	}

	res := &ListFavoritesResponse{
		Memes:   []*model.MemeView{},
		Folders: []*model.NodeView{},
	}

	if len(assetIDs) > 0 {
		memes, err := s.memeService.getMemeViews(ctx, r, assetIDs)
		if err != nil {
			return nil, err
		}
		for _, id := range assetIDs {
			if m, ok := memes[id]; ok {
				res.Memes = append(res.Memes, m)
			}
		}
	}

	if len(nodeIDs) > 0 {
		nodes, err := r.Node.GetMany(ctx, nodeIDs)
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
