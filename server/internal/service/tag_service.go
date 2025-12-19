package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/repository"
)

type TagService struct {
	repo *repository.Provider
}

func NewTagService(repo *repository.Provider) *TagService {
	return &TagService{repo: repo}
}

func (s *TagService) ListTags(ctx context.Context, scope *model.TagScope) ([]*model.Tag, error) {
	return s.repo.Tag.ListTags(ctx, scope)
}

func (s *TagService) CreateTag(ctx context.Context, name string, scope model.TagScope) (*model.Tag, error) {
	return s.repo.Tag.CreateTag(ctx, name, scope)
}

func (s *TagService) UpdateTag(ctx context.Context, id int, name string) (*model.Tag, error) {
	return s.repo.Tag.UpdateTag(ctx, id, name)
}

func (s *TagService) DeleteTag(ctx context.Context, id int) error {
	return s.repo.Tag.DeleteTag(ctx, id)
}

func (s *TagService) AddTagToNode(ctx context.Context, nodeID string, tagID int) error {
	return s.repo.Tag.AddTagToNode(ctx, nodeID, tagID)
}

func (s *TagService) RemoveTagFromNode(ctx context.Context, nodeID string, tagID int) error {
	return s.repo.Tag.RemoveTagFromNode(ctx, nodeID, tagID)
}
