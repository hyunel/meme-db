package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
)

type MemeServiceConfig struct {
	RetrievalPrompt string
	BatchSize       int
}

type MemeService struct {
	cfg          MemeServiceConfig
	repo         *repository.Provider
	assetService *AssetService
	inferClient  inference.InferenceService
}

func NewMemeService(
	cfg MemeServiceConfig,
	repo *repository.Provider,
	assetService *AssetService,
	inferClient inference.InferenceService,
) *MemeService {
	return &MemeService{
		cfg:          cfg,
		repo:         repo,
		assetService: assetService,
		inferClient:  inferClient,
	}
}

func (s *MemeService) GetSimilarMemes(ctx context.Context, userID string, assetID string, limit int) ([]model.SearchResult, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()

	results, err := r.Meme.SearchSimilar(ctx, repository.SearchSimilarParams{
		SourceAssetID: assetID,
		Metaphor:      repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
		Semantic:      repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
		Clip:          repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to perform similarity search: %w", err)
	}

	if len(results) == 0 {
		return []model.SearchResult{}, nil
	}

	assetIDs := make([]string, len(results))
	for i, res := range results {
		assetIDs[i] = res.AssetID
	}
	memeMap, err := s.getMemeViews(ctx, r, assetIDs)
	if err != nil {
		return nil, err
	}

	finalRes := make([]model.SearchResult, 0, len(results))
	for _, res := range results {
		meme, ok := memeMap[res.AssetID]
		if !ok {
			continue
		}
		finalRes = append(finalRes, model.SearchResult{
			Meme:       meme,
			RecallType: res.RecallType,
			Score:      res.Similarity,
			Similarity: res.Similarity,
		})
	}

	sort.Slice(finalRes, func(i, j int) bool {
		return finalRes[i].Similarity > finalRes[j].Similarity
	})

	if limit > 0 && len(finalRes) > limit {
		finalRes = finalRes[:limit]
	}

	return finalRes, nil
}

type SearchParams struct {
	Query    string
	Image    *inference.ImageInput
	Limit    int
	Scope    string
	UserID   string
	FolderID string
}

func (s *MemeService) Search(ctx context.Context, params SearchParams) ([]model.SearchResult, error) {
	r, release, err := s.repo.Conn(ctx, params.UserID)
	if err != nil {
		return nil, err
	}
	defer release()

	var folderPath *string
	if params.FolderID != "" {
		node, err := r.Node.Get(ctx, params.FolderID)
		if err != nil {
			return nil, fmt.Errorf("failed to get folder node: %w", err)
		}
		folderPath = &node.Path
	}

	var textVec, clipTextVec, clipImageVec []float32
	g, gCtx := errgroup.WithContext(ctx)

	if params.Query != "" {
		g.Go(func() error {
			vec, err := s.inferClient.TextEmbedding(gCtx, params.Query, s.cfg.RetrievalPrompt)
			if err != nil {
				return err
			}
			textVec = vec
			return nil
		})

		g.Go(func() error {
			vec, err := s.inferClient.ClipTextEmbedding(gCtx, params.Query)
			if err != nil {
				return err
			}
			clipTextVec = vec
			return nil
		})
	}

	if params.Image != nil {
		g.Go(func() error {
			vec, err := s.inferClient.ClipImageEmbedding(gCtx, *params.Image)
			if err != nil {
				return err
			}
			clipImageVec = vec
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to get embeddings: %w", err)
	}

	imageMode := len(clipImageVec) > 0
	results, err := r.Meme.SearchCombined(ctx, repository.SearchCombinedParams{
		ClipImage:  repository.RecallConfig[pgvector.Vector]{Enabled: imageMode, Value: pgvector.NewVector(clipImageVec), Limit: 50},
		Metaphor:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(textVec) > 0, Value: pgvector.NewVector(textVec), Limit: 15},
		Semantic:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(textVec) > 0, Value: pgvector.NewVector(textVec), Limit: 10},
		ClipText:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(clipTextVec) > 0, Value: pgvector.NewVector(clipTextVec), Limit: 15},
		OCR:        repository.RecallConfig[string]{Enabled: !imageMode && params.Query != "", Value: params.Query, Limit: 10},
		Scope:      params.Scope,
		FolderPath: folderPath,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to perform database search: %w", err)
	}

	if len(results) == 0 {
		return []model.SearchResult{}, nil
	}

	candidates := make([]*model.SearchCandidate, 0, len(results))
	scores := make([]float32, 0, len(results))

	if params.Query != "" {
		docs := make([]string, 0, len(results))
		for _, res := range results {
			out, err := inference.ParseVLMOutput(string(res.VLMJSON))
			if err != nil {
				slog.Warn("Failed to parse VLM output for rerank doc", "asset_id", res.AssetID, "error", err)
				continue
			}
			candidates = append(candidates, res)
			docs = append(docs, out.GetRerankDoc())
		}

		scores = make([]float32, len(candidates))
		rerankG, rerankCtx := errgroup.WithContext(ctx)
		for i, doc := range docs {
			rerankG.Go(func() error {
				score, err := s.inferClient.Rerank(rerankCtx, params.Query, doc, s.cfg.RetrievalPrompt)
				if err != nil {
					return err
				}
				scores[i] = score
				return nil
			})
		}

		if err := rerankG.Wait(); err != nil {
			return nil, fmt.Errorf("failed to rerank: %w", err)
		}
	} else {
		for _, res := range results {
			candidates = append(candidates, res)
			scores = append(scores, res.Similarity)
		}
	}

	assetIDs := make([]string, len(candidates))
	for i, c := range candidates {
		assetIDs[i] = c.AssetID
	}
	memeMap, err := s.getMemeViews(ctx, r, assetIDs)
	if err != nil {
		return nil, err
	}

	finalRes := make([]model.SearchResult, len(candidates))
	for i, c := range candidates {
		meme, ok := memeMap[c.AssetID]
		if !ok {
			return nil, fmt.Errorf("missing meme aggregate for asset %s", c.AssetID)
		}
		finalRes[i] = model.SearchResult{
			Meme:       meme,
			RecallType: c.RecallType,
			Score:      scores[i],
			Similarity: c.Similarity,
		}
	}

	sort.Slice(finalRes, func(i, j int) bool {
		return finalRes[i].Score > finalRes[j].Score
	})

	if params.Limit > 0 && len(finalRes) > params.Limit {
		finalRes = finalRes[:params.Limit]
	}

	return finalRes, nil
}

// getMemeViews is internal helper that uses existing connection with RLS context.
func (s *MemeService) getMemeViews(ctx context.Context, r *repository.Repos, assetIDs []string) (map[string]*model.MemeView, error) {
	memes, err := r.Meme.GetViews(ctx, assetIDs)
	if err != nil {
		return nil, err
	}

	_, assetFavs, err := r.Favorite.GetStatus(ctx, nil, assetIDs)
	if err != nil {
		return nil, err
	}

	tagsMap, err := r.Tag.GetTagsByAssets(ctx, assetIDs)
	if err != nil {
		slog.Error("failed to fetch tags for memes", "error", err)
	}

	for id, meme := range memes {
		meme.URL = s.assetService.GetAssetURL(meme.AssetID)
		meme.IsFavorite = assetFavs[id]
		if tags, ok := tagsMap[id]; ok {
			meme.Tags = tags
		} else {
			meme.Tags = make([]*model.Tag, 0)
		}
	}
	return memes, nil
}

// GetMemeViews is public method that creates its own connection.
func (s *MemeService) GetMemeViews(ctx context.Context, userID string, assetIDs []string) (map[string]*model.MemeView, error) {
	r, release, err := s.repo.Conn(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer release()
	return s.getMemeViews(ctx, r, assetIDs)
}

func (s *MemeService) GetMemeView(ctx context.Context, userID string, assetID string) (*model.MemeView, error) {
	memes, err := s.GetMemeViews(ctx, userID, []string{assetID})
	if err != nil {
		return nil, err
	}
	meme, ok := memes[assetID]
	if !ok {
		return nil, apperror.NotFound(fmt.Sprintf("meme not found: %s", assetID))
	}
	return meme, nil
}

func (s *MemeService) RetryProcessing(ctx context.Context, userID string, assetIDs []string) error {
	if len(assetIDs) == 0 {
		return nil
	}

	memes, err := s.GetMemeViews(ctx, userID, assetIDs)
	if err != nil {
		return err
	}

	var validIDs []string
	for _, id := range assetIDs {
		meme, ok := memes[id]
		if !ok {
			return apperror.NotFound(fmt.Sprintf("meme not found: %s", id))
		}
		if meme.ProcessingStatus != model.ProcessingStatusFailed {
			continue
		}
		validIDs = append(validIDs, id)
	}

	if len(validIDs) == 0 {
		return nil
	}

	return s.repo.TxNoRLS(ctx, func(r *repository.Repos) error {
		if err := r.Meme.ResetStatus(ctx, validIDs); err != nil {
			return fmt.Errorf("failed to reset meme status: %w", err)
		}

		for _, id := range validIDs {
			_, err = r.Task.CreateWithOpts(ctx, model.JobProcessMemes, map[string]any{
				"start_id":   id,
				"batch_size": s.cfg.BatchSize,
			}, &repository.TaskOpts{Priority: model.PriorityNormal})
			if err != nil {
				return fmt.Errorf("failed to create retry task for %s: %w", id, err)
			}
		}
		return nil
	})
}
