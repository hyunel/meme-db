package service

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/repository"
)

type TagService struct {
	repo        *repository.Provider
	memeService *MemeService
}

func NewTagService(repo *repository.Provider, memeService *MemeService) *TagService {
	return &TagService{
		repo:        repo,
		memeService: memeService,
	}
}

func (s *TagService) GetMemeTags(ctx context.Context, assetID string, userID string) ([]*model.Tag, error) {
	var uid *string
	if userID != "" {
		uid = &userID
	}
	return s.repo.Tag.GetAssetTags(ctx, assetID, uid)
}

func (s *TagService) SearchTags(ctx context.Context, query string) ([]*model.Tag, error) {
	return s.repo.Tag.SearchTags(ctx, query)
}

func (s *TagService) AddTagToMeme(ctx context.Context, assetID string, userID string, tagName string) (*model.Tag, error) {
	var tag *model.Tag
	err := s.repo.Transaction(ctx, func(r *repository.Repositories) error {
		var err error
		tag, err = r.Tag.CreateTag(ctx, tagName)
		if err != nil {
			return err
		}

		return r.Tag.AddAssetTag(ctx, assetID, tag.ID, &userID)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to add tag to meme: %w", err)
	}

	// Set type to USER for the response since the user just added it
	tag.Type = "USER"
	return tag, nil
}

func (s *TagService) RemoveTagFromMeme(ctx context.Context, assetID string, userID string, tagID string) error {
	return s.repo.Tag.RemoveAssetTag(ctx, assetID, tagID, &userID)
}

func (s *TagService) GetTagMemes(ctx context.Context, tagID string, userID string) (*model.Tag, []*model.MemeView, error) {
	tag, err := s.repo.Tag.GetTag(ctx, tagID)
	if err != nil {
		return nil, nil, err
	}

	assets, err := s.repo.Tag.GetAssetsByTag(ctx, tagID)
	if err != nil {
		return nil, nil, err
	}

	assetIDs := make([]string, len(assets))
	for i, a := range assets {
		assetIDs[i] = a.ID
	}

	memeMap, err := s.memeService.GetMemeViews(ctx, assetIDs, userID)
	if err != nil {
		return nil, nil, err
	}

	// Maintain order from GetAssetsByTag
	memes := make([]*model.MemeView, 0, len(assets))
	for _, a := range assets {
		if m, ok := memeMap[a.ID]; ok {
			memes = append(memes, m)
		}
	}

	return tag, memes, nil
}
