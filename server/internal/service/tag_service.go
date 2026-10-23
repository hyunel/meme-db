package service

import (
	"context"
	"fmt"
	"maps"
	"math"
	"slices"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
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

// Resolve maps spellings to their labels, creating the missing ones under the tags they mean; user is whether they are a user's own tags.
func (s *TagService) Resolve(ctx context.Context, names []string, user bool) ([]string, error) {
	ids := make([]string, len(names))
	for i, name := range names {
		var err error
		if ids[i], err = s.resolve(ctx, name, user); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// A new spelling joins the tag of one with the same key. Otherwise a system one joins the most similar tag if close enough,
// else starts a tag; a user's starts a tag without an embedding, which no similarity reaches until the VLM uses it.
func (s *TagService) resolve(ctx context.Context, name string, user bool) (string, error) {
	match, err := s.repo.Tag.TagOf(ctx, name)
	if err != nil {
		return "", err
	}
	if match != nil && !user && !match.Embedded {
		vec, err := s.embed(ctx, match.TagName)
		if err != nil {
			return "", err
		}
		if err := s.repo.Tag.SetEmbeddings(ctx, []string{match.TagName}, []pgvector.Vector{vec}); err != nil {
			return "", err
		}
	}
	if match != nil && match.LabelID != "" {
		return match.LabelID, nil
	}

	var tagID string
	switch {
	case match != nil:
		tagID = match.TagID
	case user:
		if tagID, err = s.repo.Tag.Create(ctx, name, nil); err != nil {
			return "", err
		}
	default:
		vec, err := s.embed(ctx, name)
		if err != nil {
			return "", err
		}
		var similarity float64
		if tagID, similarity, err = s.repo.Tag.Nearest(ctx, vec); err != nil {
			return "", err
		}
		if tagID == "" || similarity < s.cfg.MergeSimilarity {
			if tagID, err = s.repo.Tag.Create(ctx, name, &vec); err != nil {
				return "", err
			}
		}
	}
	return s.repo.Tag.SetLabel(ctx, name, tagID)
}

func (s *TagService) embed(ctx context.Context, name string) (pgvector.Vector, error) {
	emb, err := s.inferClient.TextEmbedding(ctx, name, s.cfg.Prompt)
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("failed to embed tag: %w", err)
	}
	return pgvector.NewVector(emb), nil
}

// EmbedMissing embeds the meme's tags from the VLM that have no embedding.
func (s *TagService) EmbedMissing(ctx context.Context, assetID string) error {
	names, err := s.repo.Tag.Unembedded(ctx, assetID)
	if err != nil || len(names) == 0 {
		return err
	}
	vectors := make([]pgvector.Vector, len(names))
	g, gCtx := errgroup.WithContext(ctx) // Side by side, so they batch
	for i, name := range names {
		g.Go(func() (err error) {
			vectors[i], err = s.embed(gCtx, name)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return err
	}
	return s.repo.Tag.SetEmbeddings(ctx, names, vectors)
}

func (s *TagService) AddToMeme(ctx context.Context, viewer *rbac.Identity, memeID, name string) (*model.MemeTag, error) {
	if _, err := s.memes.Get(ctx, viewer, memeID, ""); err != nil {
		return nil, err
	}
	labelID, err := s.resolve(ctx, name, true)
	if err != nil {
		return nil, err
	}
	return s.repo.Tag.AddUserLabel(ctx, memeID, labelID, viewer.UserID)
}

func (s *TagService) RemoveFromMeme(ctx context.Context, viewer *rbac.Identity, memeID, tagID string) error {
	return s.repo.Tag.RemoveUserTag(ctx, memeID, tagID, viewer.UserID)
}

func (s *TagService) Hot(ctx context.Context, limit int) ([]string, error) {
	tags, err := s.repo.Tag.Hot(ctx, s.cfg.MinUsage, limit)
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

// Refresh recounts the tags' usage and clusters the similar tags that Duplicates lists.
func (s *TagService) Refresh(ctx context.Context, _ *model.Task) error {
	if err := s.repo.Tag.RefreshUsage(ctx); err != nil {
		return fmt.Errorf("failed to count tag usage: %w", err)
	}
	clusters, err := s.clusterSimilar(ctx)
	if err != nil {
		return fmt.Errorf("failed to cluster similar tags: %w", err)
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error { return r.Tag.SetClusters(ctx, clusters) })
}

// clusterSimilar groups similar tags by average linkage into clusters of two or more.
func (s *TagService) clusterSimilar(ctx context.Context) ([][]string, error) {
	pairs, err := s.repo.Tag.SimilarPairs(ctx, s.cfg.SuggestSimilarity)
	if err != nil || len(pairs) == 0 {
		return nil, err
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
	var clusters [][]string
	for _, component := range components {
		for _, c := range averageLinkage(component, embeddings, s.cfg.SuggestSimilarity) {
			if len(c) > 1 {
				clusters = append(clusters, c)
			}
		}
	}
	return clusters, nil
}

// Duplicates lists the clusters of similar tags, most used first within and across groups.
func (s *TagService) Duplicates(ctx context.Context) ([][]*model.TagUsage, error) {
	cluster, err := s.repo.Tag.Clusters(ctx)
	if err != nil || len(cluster) == 0 {
		return [][]*model.TagUsage{}, err
	}
	tags, err := s.repo.Tag.Get(ctx, slices.Collect(maps.Keys(cluster)), s.cfg.CommonShare)
	if err != nil {
		return nil, err
	}
	grouped := map[int][]*model.TagUsage{}
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
		if len(grouped[c]) > 1 { // Merges may have left one
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
		match, err := r.Tag.TagOf(ctx, name)
		if err != nil {
			return err
		}
		if match != nil && match.TagID != id {
			return apperror.Conflict("tag_name_taken", "a tag of that name exists; merge them instead")
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
		return apperror.BadRequest("merge_into_source", "the target tag cannot be one of those merged")
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error { return r.Tag.Merge(ctx, sourceIDs, targetID) })
}

func (s *TagService) Delete(ctx context.Context, ids []string) error {
	return s.repo.Tx(ctx, func(r *repository.Repos) error { return r.Tag.Delete(ctx, ids) })
}
