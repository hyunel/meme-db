package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

// UserService administers user accounts.
type UserService struct {
	repo  *repository.Provider
	memes *MemeService
}

func NewUserService(repo *repository.Provider, memes *MemeService) *UserService {
	return &UserService{repo: repo, memes: memes}
}

func (s *UserService) List(ctx context.Context, f repository.UserFilter, page repository.Page) (*model.Page[*model.AdminUser], error) {
	users, total, err := s.repo.User.List(ctx, f, page)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.AdminUser]{Items: users, Total: total}, nil
}

type UserDetail struct {
	model.AdminUser
	Recent []*model.Meme `json:"recent"` // Latest files added to the user's library
}

func (s *UserService) Get(ctx context.Context, viewer *rbac.Identity, id string) (*UserDetail, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.NotFound("用户不存在")
	}
	stats, err := s.repo.User.Stats(ctx, id)
	if err != nil {
		return nil, err
	}
	assetIDs, err := s.repo.Node.RecentFileAssets(ctx, id, 12)
	if err != nil {
		return nil, err
	}
	recent, err := s.memes.Memes(ctx, viewer, assetIDs)
	if err != nil {
		return nil, err
	}
	return &UserDetail{AdminUser: model.AdminUser{User: *user, UserStats: *stats}, Recent: recent}, nil
}

// Stats counts a user's library items and favorites.
func (s *UserService) Stats(ctx context.Context, id string) (*model.UserStats, error) {
	return s.repo.User.Stats(ctx, id)
}

func (s *UserService) Create(ctx context.Context, username, email, password, role string) (*model.User, error) {
	return createUser(ctx, s.repo, username, email, password, role)
}

// Update changes the role and/or status of another user (nil leaves it unchanged).
// Admins cannot demote or disable themselves, so at least one active admin always remains.
func (s *UserService) Update(ctx context.Context, actor *rbac.Identity, id string, role, status *string) error {
	if err := s.checkTarget(ctx, actor, id); err != nil {
		return err
	}
	return s.repo.User.Update(ctx, id, role, status)
}

func (s *UserService) ResetPassword(ctx context.Context, id, password string) error {
	if _, err := s.find(ctx, id); err != nil {
		return err
	}
	return setPassword(ctx, s.repo.Repos, id, password)
}

// Delete deletes another user with their library, favorites and tags.
func (s *UserService) Delete(ctx context.Context, actor *rbac.Identity, id string) error {
	if err := s.checkTarget(ctx, actor, id); err != nil {
		return err
	}
	return s.repo.User.Delete(ctx, id)
}

func (s *UserService) checkTarget(ctx context.Context, actor *rbac.Identity, id string) error {
	if id == actor.UserID {
		return apperror.Forbidden("不能修改或删除自己的账号")
	}
	_, err := s.find(ctx, id)
	return err
}

func (s *UserService) find(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err == nil && user == nil {
		err = apperror.NotFound("用户不存在")
	}
	return user, err
}
