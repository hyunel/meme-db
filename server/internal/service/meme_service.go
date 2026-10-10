package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
)

type MemeServiceConfig struct {
	RetrievalPrompt string
}

type MemeService struct {
	cfg         MemeServiceConfig
	repo        *repository.Provider
	assets      *AssetService
	inferClient inference.InferenceService
	notifier    Notifier
}

func NewMemeService(
	cfg MemeServiceConfig,
	repo *repository.Provider,
	assets *AssetService,
	inferClient inference.InferenceService,
	notifier Notifier,
) *MemeService {
	return &MemeService{
		cfg:         cfg,
		repo:        repo,
		assets:      assets,
		inferClient: inferClient,
		notifier:    notifier,
	}
}

// Memes returns the memes among ids that viewer may see, in the order of ids.
func (s *MemeService) Memes(ctx context.Context, viewer *rbac.Identity, ids []string) ([]*model.Meme, error) {
	memes, err := s.repo.Meme.Memes(ctx, viewer.UserID, viewer.IsAdmin(), ids)
	if err != nil {
		return nil, err
	}
	s.assets.signMemes(memes)
	return orderByID(memes, ids, func(m *model.Meme) string { return m.ID }), nil
}

func (s *MemeService) Get(ctx context.Context, viewer *rbac.Identity, id string) (*model.Meme, error) {
	memes, err := s.Memes(ctx, viewer, []string{id})
	if err != nil {
		return nil, err
	}
	if len(memes) == 0 {
		return nil, apperror.NotFound("表情包不存在或尚未公开")
	}
	return memes[0], nil
}

// Popular lists public memes, optionally only those tagged tag, most popular first.
func (s *MemeService) Popular(ctx context.Context, viewer *rbac.Identity, tag string, limit int) (*model.Page[*model.Meme], error) {
	ids, total, err := s.repo.Meme.PublicIDs(ctx, viewer.UserID, tag, limit)
	if err != nil {
		return nil, err
	}
	memes, err := s.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.Meme]{Items: memes, Total: total}, nil
}

// Similar finds memes close to a meme the viewer can see, among public memes and the
// viewer's library.
func (s *MemeService) Similar(ctx context.Context, viewer *rbac.Identity, id string, limit int) ([]*model.Meme, error) {
	if _, err := s.Get(ctx, viewer, id); err != nil {
		return nil, err
	}
	metaphor, semantic, clip, err := s.repo.Meme.Vectors(ctx, id)
	if err != nil {
		return nil, err
	}

	var recalls []repository.Recall
	for _, v := range []struct {
		name string
		vec  *pgvector.Vector
	}{{"metaphor_vector", metaphor}, {"semantic_vector", semantic}, {"clip_vector", clip}} {
		if v.vec != nil {
			recalls = append(recalls, repository.Recall{Type: v.name, Column: v.name, Value: *v.vec, Limit: limit})
		}
	}
	candidates, err := s.repo.Meme.Recall(ctx, recalls, repository.RecallScope{
		ViewerID: viewer.UserID,
		Public:   true,
		Owned:    true,
		Exclude:  id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to perform similarity search: %w", err)
	}

	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Similarity > candidates[j].Similarity })
	ids := make([]string, 0, min(limit, len(candidates)))
	for _, c := range candidates[:min(limit, len(candidates))] {
		ids = append(ids, c.AssetID)
	}
	return s.Memes(ctx, viewer, ids)
}

type SearchParams struct {
	Viewer   *rbac.Identity
	Query    string
	Image    *inference.ImageInput
	Mine     bool   // Search the viewer's library instead of public memes
	FolderID string // With Mine, restricts the search to a folder subtree
	Limit    int
}

// Search recalls candidates by text (semantic, metaphor, CLIP and OCR channels) or by
// image (CLIP), then reranks them against the text query if there is one.
func (s *MemeService) Search(ctx context.Context, params SearchParams) ([]model.SearchResult, error) {
	scope := repository.RecallScope{ViewerID: params.Viewer.UserID, Public: !params.Mine, Owned: params.Mine}
	if params.Mine && params.Viewer.UserID == "" {
		return nil, apperror.Unauthorized("登录后才能搜索我的库")
	}
	if params.Mine && params.FolderID != "" {
		folder, err := s.repo.Node.Get(ctx, params.FolderID)
		if err != nil {
			return nil, err
		}
		if folder == nil || folder.OwnerID != params.Viewer.UserID || folder.Type != model.NodeTypeFolder {
			return nil, apperror.NotFound("文件夹不存在")
		}
		scope.FolderPath = &folder.Path
	}

	var textVec, clipTextVec, clipImageVec []float32
	g, gCtx := errgroup.WithContext(ctx)
	if params.Image != nil {
		g.Go(func() (err error) {
			clipImageVec, err = s.inferClient.ClipImageEmbedding(gCtx, *params.Image)
			return err
		})
	} else if params.Query != "" {
		g.Go(func() (err error) {
			textVec, err = s.inferClient.TextEmbedding(gCtx, params.Query, s.cfg.RetrievalPrompt)
			return err
		})
		g.Go(func() (err error) {
			clipTextVec, err = s.inferClient.ClipTextEmbedding(gCtx, params.Query)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to get embeddings: %w", err)
	}

	var recalls []repository.Recall
	if params.Image != nil {
		recalls = []repository.Recall{{Type: "clip_image", Column: "clip_vector", Value: pgvector.NewVector(clipImageVec), Limit: 50}}
	} else if params.Query != "" {
		recalls = []repository.Recall{
			{Type: "metaphor", Column: "metaphor_vector", Value: pgvector.NewVector(textVec), Limit: 15},
			{Type: "semantic", Column: "semantic_vector", Value: pgvector.NewVector(textVec), Limit: 10},
			{Type: "clip_text", Column: "clip_vector", Value: pgvector.NewVector(clipTextVec), Limit: 15},
			{Type: "ocr", Column: "ocr_text", Value: params.Query, Limit: 10},
		}
	}
	candidates, err := s.repo.Meme.Recall(ctx, recalls, scope)
	if err != nil {
		return nil, fmt.Errorf("failed to perform database search: %w", err)
	}

	scores, err := s.rerank(ctx, params.Query, candidates)
	if err != nil {
		return nil, err
	}

	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.AssetID
	}
	memes, err := s.Memes(ctx, params.Viewer, ids)
	if err != nil {
		return nil, err
	}
	memeByID := make(map[string]*model.Meme, len(memes))
	for _, m := range memes {
		memeByID[m.ID] = m
	}

	results := make([]model.SearchResult, 0, len(candidates))
	for i, c := range candidates {
		if meme, ok := memeByID[c.AssetID]; ok {
			results = append(results, model.SearchResult{Meme: meme, RecallType: c.RecallType, Score: scores[i], Similarity: c.Similarity})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if params.Limit > 0 && len(results) > params.Limit {
		results = results[:params.Limit]
	}
	return results, nil
}

// rerank scores candidates against the text query; without one, recall similarity is the score.
func (s *MemeService) rerank(ctx context.Context, query string, candidates []*model.SearchCandidate) ([]float32, error) {
	scores := make([]float32, len(candidates))
	if query == "" {
		for i, c := range candidates {
			scores[i] = c.Similarity
		}
		return scores, nil
	}

	g, gCtx := errgroup.WithContext(ctx)
	for i, c := range candidates {
		out, err := inference.ParseVLMOutput(string(c.VLMJSON))
		if err != nil {
			slog.Warn("Failed to parse VLM output for rerank doc", "asset_id", c.AssetID, "error", err)
			scores[i] = -1 // Rank unparsable candidates last
			continue
		}
		g.Go(func() (err error) {
			scores[i], err = s.inferClient.Rerank(gCtx, query, out.GetRerankDoc(), s.cfg.RetrievalPrompt)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to rerank: %w", err)
	}
	return scores, nil
}

// Retry re-queues a meme whose analysis failed; the viewer must have it in their library.
func (s *MemeService) Retry(ctx context.Context, viewer *rbac.Identity, id string) error {
	meme, err := s.Get(ctx, viewer, id)
	if err != nil {
		return err
	}
	if meme.Entry == nil && !viewer.IsAdmin() {
		return apperror.Forbidden("只能重试自己库中的表情包")
	}
	_, err = s.reanalyze(ctx, []string{id}, model.ProcessingStatusFailed)
	return err
}

// Reprocess re-analyzes memes that are not already queued and returns how many were queued.
func (s *MemeService) Reprocess(ctx context.Context, ids []string) (int, error) {
	return s.reanalyze(ctx, ids, model.ProcessingStatusSuccess, model.ProcessingStatusFailed)
}

// ReprocessMatching re-analyzes every meme matching f.
func (s *MemeService) ReprocessMatching(ctx context.Context, f repository.MemeFilter) (int, error) {
	ids, _, err := s.repo.Meme.FilterIDs(ctx, f, nil)
	if err != nil {
		return 0, err
	}
	return s.Reprocess(ctx, ids)
}

func (s *MemeService) reanalyze(ctx context.Context, ids []string, from ...string) (int, error) {
	var reset []string
	err := s.repo.Tx(ctx, func(r *repository.Repos) (err error) {
		if reset, err = r.Meme.ResetForAnalysis(ctx, ids, from); err != nil {
			return err
		}
		return enqueueAnalysis(ctx, r, model.PriorityNormal, reset...)
	})
	if err != nil {
		return 0, err
	}
	if len(reset) > 0 {
		s.notifier.Notify()
	}
	return len(reset), nil
}

// List lists memes for administration, newest first.
func (s *MemeService) List(ctx context.Context, viewer *rbac.Identity, f repository.MemeFilter, page repository.Page) (*model.Page[*model.Meme], error) {
	ids, total, err := s.repo.Meme.FilterIDs(ctx, f, &page)
	if err != nil {
		return nil, err
	}
	memes, err := s.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.Meme]{Items: memes, Total: total}, nil
}

// Delete permanently deletes memes, removing them from every library.
func (s *MemeService) Delete(ctx context.Context, ids []string) (int, error) {
	paths, err := s.repo.Asset.Delete(ctx, ids)
	if err != nil {
		return 0, err
	}
	s.assets.RemoveFiles(paths)
	return len(paths), nil
}
