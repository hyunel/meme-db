package service

import (
	"context"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type SourceService struct {
	repo *repository.Provider
	tags *TagService
}

func NewSourceService(repo *repository.Provider, tags *TagService) *SourceService {
	return &SourceService{repo: repo, tags: tags}
}

func (s *SourceService) List(ctx context.Context) ([]*model.Source, error) {
	sources, err := s.repo.Source.List(ctx)
	if sources == nil {
		sources = []*model.Source{}
	}
	return sources, err
}

func (s *SourceService) Update(ctx context.Context, source string, tags map[string][]string) error {
	if source == model.SourceVLM {
		return apperror.Forbidden("source_reserved", "the VLM's source is the site's own")
	}
	var names []string
	seen := map[string]bool{}
	for _, given := range tags {
		for _, name := range given {
			if !seen[name] {
				seen[name] = true
				names = append(names, name)
			}
		}
	}
	ids, err := s.tags.Resolve(ctx, names, true)
	if err != nil {
		return err
	}
	label := make(map[string]string, len(names))
	for i, name := range names {
		label[name] = ids[i]
	}
	labels := make(map[string][]string, len(tags))
	for id, given := range tags {
		labels[id] = make([]string, len(given))
		for i, name := range given {
			labels[id][i] = label[name]
		}
	}

	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		if err := r.Source.Ensure(ctx, source); err != nil {
			return err
		}
		if len(labels) > 0 {
			return r.Tag.SetSourceLabels(ctx, source, labels)
		}
		return nil
	})
}

func (s *SourceService) Delete(ctx context.Context, source string) error {
	if source == model.SourceVLM {
		return apperror.Forbidden("source_reserved", "the VLM's source is the site's own")
	}
	deleted, err := s.repo.Source.Delete(ctx, source)
	if err == nil && !deleted {
		err = apperror.NotFound("source_not_found", "source not found")
	}
	return err
}
