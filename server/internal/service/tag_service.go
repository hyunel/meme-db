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

func (s *TagService) GetMemeTags(ctx context.Context, userID string, assetID string) ([]*model.Tag, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()
	return r.Tag.GetAssetTags(ctx, assetID)
}

func (s *TagService) SearchTags(ctx context.Context, query string) ([]*model.Tag, error) {
	return s.repo.Tag.Search(ctx, query)
}

func (s *TagService) AddTagToMeme(ctx context.Context, userID string, assetID string, tagName string) (*model.Tag, error) {
	var tag *model.Tag
	err := s.repo.Tx(ctx, userID, func(r *repository.Repos) error {
		var err error
		tag, err = r.Tag.Create(ctx, tagName)
		if err != nil {
			return err
		}
		return r.Tag.AddToAsset(ctx, assetID, tag.ID)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to add tag to meme: %w", err)
	}

	tag.Type = "USER"
	return tag, nil
}

func (s *TagService) RemoveTagFromMeme(ctx context.Context, userID string, assetID string, tagID string) error {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return err
	}
	defer release()
	return r.Tag.RemoveFromAsset(ctx, assetID, tagID)
}

func (s *TagService) GetTagMemes(ctx context.Context, userID string, tagID string) (*model.Tag, []*model.MemeView, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	defer release()

	tag, err := r.Tag.Get(ctx, tagID)
	if err != nil {
		return nil, nil, err
	}

	assets, err := r.Tag.GetAssetsByTag(ctx, tagID)
	if err != nil {
		return nil, nil, err
	}

	assetIDs := make([]string, len(assets))
	for i, a := range assets {
		assetIDs[i] = a.ID
	}

	memeMap, err := s.memeService.getMemeViews(ctx, r, assetIDs)
	if err != nil {
		return nil, nil, err
	}

	memes := make([]*model.MemeView, 0, len(assets))
	for _, a := range assets {
		if m, ok := memeMap[a.ID]; ok {
			memes = append(memes, m)
		}
	}

	return tag, memes, nil
}
