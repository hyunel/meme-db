package service

import (
	"context"
	"slices"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

type TagService struct {
	repo  *repository.Provider
	memes *MemeService
}

func NewTagService(repo *repository.Provider, memes *MemeService) *TagService {
	return &TagService{repo: repo, memes: memes}
}

// AddToMeme adds one of the viewer's own tags to a meme they can see.
func (s *TagService) AddToMeme(ctx context.Context, viewer *rbac.Identity, memeID, name string) (*model.MemeTag, error) {
	if _, err := s.memes.Get(ctx, viewer, memeID); err != nil {
		return nil, err
	}
	var tag *model.Tag
	err := s.repo.Tx(ctx, func(r *repository.Repos) (err error) {
		if tag, err = r.Tag.Upsert(ctx, name); err != nil {
			return err
		}
		return r.Tag.AddUserTag(ctx, memeID, tag.ID, viewer.UserID)
	})
	if err != nil {
		return nil, err
	}
	return &model.MemeTag{ID: tag.ID, Name: tag.Name, Mine: true}, nil
}

func (s *TagService) RemoveFromMeme(ctx context.Context, viewer *rbac.Identity, memeID, tagID string) error {
	return s.repo.Tag.RemoveUserTag(ctx, memeID, tagID, viewer.UserID)
}

// Hot returns the system tags used most on public memes.
func (s *TagService) Hot(ctx context.Context, limit int) ([]string, error) {
	tags, err := s.repo.Tag.Hot(ctx, limit)
	if tags == nil {
		tags = []string{}
	}
	return tags, err
}

func (s *TagService) List(ctx context.Context, query, sort string, page repository.Page) (*model.Page[*model.TagUsage], error) {
	tags, total, err := s.repo.Tag.List(ctx, query, sort, page)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.TagUsage]{Items: tags, Total: total}, nil
}

func (s *TagService) Rename(ctx context.Context, id, name string) error {
	err := s.repo.Tag.Rename(ctx, id, name)
	if repository.IsUniqueViolation(err) {
		return apperror.Conflict("已存在同名标签，请改用合并")
	}
	return err
}

// Merge moves every use of the source tags onto the target tag and deletes the sources.
func (s *TagService) Merge(ctx context.Context, sourceIDs []string, targetID string) error {
	if slices.Contains(sourceIDs, targetID) {
		return apperror.BadRequest("目标标签不能是被合并的标签")
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		return r.Tag.Merge(ctx, sourceIDs, targetID)
	})
}

func (s *TagService) Delete(ctx context.Context, ids []string) error {
	return s.repo.Tag.Delete(ctx, ids)
}
