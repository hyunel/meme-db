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
	Memes   []*model.Meme   `json:"memes"`
	Folders []*model.Folder `json:"folders"`
	// Favorites the viewer can no longer see, e.g. because they were made private
	StaleMemes   []string `json:"stale_memes"`
	StaleFolders []string `json:"stale_folders"`
}

// List returns the viewer's favorites, newest first.
func (s *FavoriteService) List(ctx context.Context, viewer *rbac.Identity) (*Favorites, error) {
	assetIDs, nodeIDs, err := s.repo.Favorite.List(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	memes, err := s.memes.Memes(ctx, viewer, assetIDs)
	if err != nil {
		return nil, err
	}
	folders, err := s.visibleFolders(ctx, viewer, nodeIDs)
	if err != nil {
		return nil, err
	}
	return &Favorites{
		Memes:        memes,
		Folders:      folders,
		StaleMemes:   missing(assetIDs, memes, func(m *model.Meme) string { return m.ID }),
		StaleFolders: missing(nodeIDs, folders, func(f *model.Folder) string { return f.ID }),
	}, nil
}

// Add favorites a meme or folder the viewer can see.
func (s *FavoriteService) Add(ctx context.Context, viewer *rbac.Identity, kind, id string) error {
	if kind == FavoriteMeme {
		if _, err := s.memes.Get(ctx, viewer, id); err != nil {
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

// ClearStale removes the favorites the viewer can no longer see.
func (s *FavoriteService) ClearStale(ctx context.Context, viewer *rbac.Identity) error {
	favs, err := s.List(ctx, viewer)
	if err != nil {
		return err
	}
	return s.repo.Favorite.Remove(ctx, viewer.UserID, favs.StaleMemes, favs.StaleFolders)
}

// visibleFolders returns the folders among ids that are public or the viewer's own.
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
