package service

import (
	"context"
	"fmt"
	"math"
	"slices"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
)

type TagServiceConfig struct {
	Prompt            string
	MergeSimilarity   float64
	SuggestSimilarity float64
	MinUsage          int
	CommonShare       float64
}

type TagService struct {
	cfg         TagServiceConfig
	repo        *repository.Provider
	memes       *MemeService
	inferClient inference.InferenceService
}

func NewTagService(cfg TagServiceConfig, repo *repository.Provider, memes *MemeService, inferClient inference.InferenceService) *TagService {
	return &TagService{cfg: cfg, repo: repo, memes: memes, inferClient: inferClient}
}

// Resolve maps spellings to their labels, creating the missing ones under the tags they mean.
func (s *TagService) Resolve(ctx context.Context, names []string) ([]string, error) {
	ids := make([]string, len(names))
	for i, name := range names {
		var err error
		if ids[i], err = s.resolve(ctx, name); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// A new spelling joins the tag of one with the same key, else the most similar tag if close enough, else a new tag.
func (s *TagService) resolve(ctx context.Context, name string) (string, error) {
	labelID, tagID, err := s.repo.Tag.TagOf(ctx, name)
	if err != nil || labelID != "" {
		return labelID, err
	}

	if tagID == "" {
		emb, err := s.inferClient.TextEmbedding(ctx, name, s.cfg.Prompt)
		if err != nil {
			return "", fmt.Errorf("failed to embed tag: %w", err)
		}
		vec := pgvector.NewVector(emb)
		var similarity float64
		if tagID, similarity, err = s.repo.Tag.Nearest(ctx, vec); err != nil {
			return "", err
		}
		if tagID == "" || similarity < s.cfg.MergeSimilarity {
			if tagID, err = s.repo.Tag.Create(ctx, name, vec); err != nil {
				return "", err
			}
		}
	}
	return s.repo.Tag.SetLabel(ctx, name, tagID)
}

func (s *TagService) AddToMeme(ctx context.Context, viewer *rbac.Identity, memeID, name string) (*model.MemeTag, error) {
	if _, err := s.memes.Get(ctx, viewer, memeID); err != nil {
		return nil, err
	}
	labelID, err := s.resolve(ctx, name)
	if err != nil {
		return nil, err
	}
	return s.repo.Tag.AddUserLabel(ctx, memeID, labelID, viewer.UserID)
}

func (s *TagService) RemoveFromMeme(ctx context.Context, viewer *rbac.Identity, memeID, tagID string) error {
	return s.repo.Tag.RemoveUserTag(ctx, memeID, tagID, viewer.UserID)
}

func (s *TagService) Hot(ctx context.Context, viewer *rbac.Identity, limit int) ([]string, error) {
	tags, err := s.repo.Tag.Hot(ctx, viewer.UserID, viewer.IsAdmin(), s.cfg.MinUsage, limit)
	if tags == nil {
		tags = []string{}
	}
	return tags, err
}

func (s *TagService) List(ctx context.Context, query, sort string, page repository.Page) (*model.Page[*model.TagUsage], error) {
	tags, total, err := s.repo.Tag.List(ctx, query, sort, page, s.cfg.CommonShare)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.TagUsage]{Items: tags, Total: total}, nil
}

// Duplicates groups similar tags by average linkage, most used first within and across groups.
func (s *TagService) Duplicates(ctx context.Context) ([][]*model.TagUsage, error) {
	pairs, err := s.repo.Tag.SimilarPairs(ctx, s.cfg.SuggestSimilarity)
	if err != nil || len(pairs) == 0 {
		return [][]*model.TagUsage{}, err
	}

	// Average linkage never joins tags without a close pair between them, so each connected component clusters alone.
	near := map[string][]string{}
	for _, p := range pairs {
		near[p[0]] = append(near[p[0]], p[1])
		near[p[1]] = append(near[p[1]], p[0])
	}
	ids := make([]string, 0, len(near))
	seen := map[string]bool{}
	var components [][]string
	for id := range near {
		ids = append(ids, id)
		if seen[id] {
			continue
		}
		seen[id] = true
		component := []string{id}
		for i := 0; i < len(component); i++ {
			for _, n := range near[component[i]] {
				if !seen[n] {
					seen[n] = true
					component = append(component, n)
				}
			}
		}
		components = append(components, component)
	}

	embeddings, err := s.repo.Tag.Embeddings(ctx, ids)
	if err != nil {
		return nil, err
	}
	cluster := map[string]int{}
	n := 0
	for _, component := range components {
		for _, c := range averageLinkage(component, embeddings, s.cfg.SuggestSimilarity) {
			for _, id := range c {
				cluster[id] = n
			}
			n++
		}
	}

	tags, err := s.repo.Tag.Get(ctx, ids, s.cfg.CommonShare)
	if err != nil {
		return nil, err
	}
	grouped := make([][]*model.TagUsage, n)
	var order []int
	for _, t := range tags { // Most used first
		c := cluster[t.ID]
		if grouped[c] == nil {
			order = append(order, c)
		}
		grouped[c] = append(grouped[c], t)
	}
	groups := [][]*model.TagUsage{}
	for _, c := range order {
		if len(grouped[c]) > 1 {
			groups = append(groups, grouped[c])
		}
	}
	return groups, nil
}

// averageLinkage merges the closest clusters while their mean pairwise similarity reaches the threshold.
func averageLinkage(ids []string, embeddings map[string][]float32, threshold float64) [][]string {
	clusters := make([][]string, len(ids))
	sim := make([][]float64, len(ids))
	for i := range ids {
		clusters[i] = []string{ids[i]}
		sim[i] = make([]float64, len(ids))
		for j := range ids {
			sim[i][j] = cosine(embeddings[ids[i]], embeddings[ids[j]])
		}
	}

	for {
		a, b := -1, -1
		for i := range clusters {
			for j := i + 1; j < len(clusters); j++ {
				if clusters[i] != nil && clusters[j] != nil && (a < 0 || sim[i][j] > sim[a][b]) {
					a, b = i, j
				}
			}
		}
		if a < 0 || sim[a][b] < threshold {
			break
		}
		na, nb := float64(len(clusters[a])), float64(len(clusters[b]))
		for k := range clusters {
			sim[a][k] = (na*sim[a][k] + nb*sim[b][k]) / (na + nb)
			sim[k][a] = sim[a][k]
		}
		clusters[a] = append(clusters[a], clusters[b]...)
		clusters[b] = nil
	}
	return slices.DeleteFunc(clusters, func(c []string) bool { return c == nil })
}

func cosine(a, b []float32) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	return dot / math.Sqrt(na*nb)
}

// Rename also makes the name a spelling of the tag, so it must not already mean another tag.
func (s *TagService) Rename(ctx context.Context, id, name string) error {
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		_, owner, err := r.Tag.TagOf(ctx, name)
		if err != nil {
			return err
		}
		if owner != "" && owner != id {
			return apperror.Conflict("已存在同名标签，请改用合并")
		}
		if err := r.Tag.Rename(ctx, id, name); err != nil {
			return err
		}
		_, err = r.Tag.SetLabel(ctx, name, id)
		return err
	})
}

func (s *TagService) SetHidden(ctx context.Context, id string, hidden bool) error {
	return s.repo.Tag.SetHidden(ctx, id, hidden)
}

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
