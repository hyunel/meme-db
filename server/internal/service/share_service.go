package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

// ShareService manages private links, which open a meme or folder of their creator's library to whoever holds one.
// A link goes by the id of what it opens, as each meme or folder has at most one.
type ShareService struct {
	repo    *repository.Provider
	memes   *MemeService
	library *LibraryService
}

func NewShareService(repo *repository.Provider, memes *MemeService, library *LibraryService) *ShareService {
	return &ShareService{repo: repo, memes: memes, library: library}
}

func (s *ShareService) Get(ctx context.Context, viewer *rbac.Identity, targetID string) (*model.ShareLink, error) {
	return s.repo.Share.Get(ctx, viewer.UserID, targetID)
}

// CreateMemeLink returns the viewer's private link to a meme in their library, making one if there is none.
func (s *ShareService) CreateMemeLink(ctx context.Context, viewer *rbac.Identity, id string) (*model.ShareLink, error) {
	meme, err := s.memes.Get(ctx, viewer, id, "")
	if err != nil {
		return nil, err
	}
	if len(meme.Entries) == 0 {
		return nil, apperror.Forbidden("只能为我的库中的表情包创建私密链接")
	}
	return s.repo.Share.Create(ctx, viewer.UserID, id, "")
}

// CreateFolderLink returns the viewer's private link to one of their folders, making one if there is none.
func (s *ShareService) CreateFolderLink(ctx context.Context, viewer *rbac.Identity, id string) (*model.ShareLink, error) {
	if _, err := s.library.ownedFolder(ctx, viewer.UserID, id); err != nil {
		return nil, err
	}
	return s.repo.Share.Create(ctx, viewer.UserID, "", id)
}

func (s *ShareService) Delete(ctx context.Context, viewer *rbac.Identity, targetID string) error {
	return s.repo.Share.Delete(ctx, viewer.UserID, targetID)
}

// View counts a page load of the meme or folder a private link opens; pages within a shared folder count for nothing.
func (s *ShareService) View(ctx context.Context, viewer *rbac.Identity, targetID, share string) error {
	return s.repo.Share.Record(ctx, share, targetID, viewer.UserID, false)
}

// List lists the viewer's private links, newest first.
func (s *ShareService) List(ctx context.Context, viewer *rbac.Identity) ([]*model.SharedItem, error) {
	links, err := s.repo.Share.List(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	var memeIDs, folderIDs []string
	for _, l := range links {
		if l.MemeID != nil {
			memeIDs = append(memeIDs, *l.MemeID)
		} else {
			folderIDs = append(folderIDs, *l.FolderID)
		}
	}
	memes, err := s.memes.Memes(ctx, viewer, memeIDs)
	if err != nil {
		return nil, err
	}
	folders, err := s.library.Folders(ctx, viewer, folderIDs)
	if err != nil {
		return nil, err
	}

	memeByID := make(map[string]*model.Meme, len(memes))
	for _, m := range memes {
		memeByID[m.ID] = m
	}
	folderByID := make(map[string]*model.Folder, len(folders))
	for _, f := range folders {
		folderByID[f.ID] = f
	}
	for _, l := range links {
		if l.MemeID != nil {
			l.Meme = memeByID[*l.MemeID]
		} else {
			l.Folder = folderByID[*l.FolderID]
		}
	}
	return links, nil
}
