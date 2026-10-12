package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

const (
	FavoriteMeme   = "meme"
	FavoriteFolder = "folder"
)

type FavoriteService struct {
	repo    *repository.Provider
	memes   *MemeService
	library *LibraryService
}

func NewFavoriteService(repo *repository.Provider, memes *MemeService, library *LibraryService) *FavoriteService {
	return &FavoriteService{repo: repo, memes: memes, library: library}
}

type Favorites struct {
	MemeCount int             `json:"meme_count"` // Favorite memes the viewer can still see, paged by Memes
	Folders   []*model.Folder `json:"folders"`
	// Favorites the viewer can no longer see, e.g. because they were made private
	StaleMemes   []string `json:"stale_memes"`
	StaleFolders []string `json:"stale_folders"`
}

func (s *FavoriteService) List(ctx context.Context, viewer *rbac.Identity) (*Favorites, error) {
	staleMemes, memeCount, err := s.repo.Favorite.StaleMemes(ctx, viewer.UserID, viewer.IsAdmin())
	if err != nil {
		return nil, err
	}
	nodeIDs, err := s.repo.Favorite.Folders(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	folders, err := s.visibleFolders(ctx, viewer, nodeIDs)
	if err != nil {
		return nil, err
	}
	return &Favorites{
		MemeCount:    memeCount,
		Folders:      folders,
		StaleMemes:   staleMemes,
		StaleFolders: missing(nodeIDs, folders, func(f *model.Folder) string { return f.ID }),
	}, nil
}

// Memes pages through the favorite memes the viewer can still see, newest first; the cursor is the id of the last favorite before.
func (s *FavoriteService) Memes(ctx context.Context, viewer *rbac.Identity, cursor string, limit int) (*model.Feed[*model.Meme], error) {
	favs, err := s.repo.Favorite.Memes(ctx, viewer.UserID, viewer.IsAdmin(), cursor, limit+1)
	if err != nil {
		return nil, err
	}
	favs, next := nextPage(favs, limit, func(f *repository.FavoriteMeme) string { return f.ID })
	ids := make([]string, len(favs))
	for i, f := range favs {
		ids[i] = f.AssetID
	}
	memes, err := s.memes.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Feed[*model.Meme]{Items: memes, Next: next}, nil
}

func (s *FavoriteService) Add(ctx context.Context, viewer *rbac.Identity, kind, id string) error {
	if kind == FavoriteMeme {
		if _, err := s.memes.Get(ctx, viewer, id, ""); err != nil {
			return err
		}
		return s.repo.Favorite.Add(ctx, viewer.UserID, &id, nil)
	}
	folders, err := s.visibleFolders(ctx, viewer, []string{id})
	if err != nil {
		return err
	}
	if len(folders) == 0 {
		return apperror.NotFound("合集不存在或未公开")
	}
	return s.repo.Favorite.Add(ctx, viewer.UserID, nil, &id)
}

func (s *FavoriteService) Remove(ctx context.Context, viewer *rbac.Identity, kind, id string) error {
	if kind == FavoriteMeme {
		return s.repo.Favorite.Remove(ctx, viewer.UserID, []string{id}, nil)
	}
	return s.repo.Favorite.Remove(ctx, viewer.UserID, nil, []string{id})
}

func (s *FavoriteService) ClearStale(ctx context.Context, viewer *rbac.Identity) error {
	favs, err := s.List(ctx, viewer)
	if err != nil {
		return err
	}
	return s.repo.Favorite.Remove(ctx, viewer.UserID, favs.StaleMemes, favs.StaleFolders)
}

func (s *FavoriteService) visibleFolders(ctx context.Context, viewer *rbac.Identity, ids []string) ([]*model.Folder, error) {
	folders, err := s.library.Folders(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	visible := folders[:0]
	for _, f := range folders {
		if f.Visibility != model.VisibilityPrivate || f.Owner.ID == viewer.UserID {
			visible = append(visible, f)
		}
	}
	return visible, nil
}
