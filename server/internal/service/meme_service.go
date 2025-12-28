package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
)

type MemeService struct {
	cfg          *config.Config
	repo         *repository.Provider
	assetService *AssetService
	inferClient  inference.InferenceService
}

func NewMemeService(
	cfg *config.Config,
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

func (s *MemeService) GetSimilarMemes(ctx context.Context, assetID string, ownerID string, limit int) ([]model.SearchResult, error) {
	// 1. Perform Multi-Channel Similarity Search
	results, err := s.repo.Meme.SearchSimilar(ctx, repository.SearchSimilarParams{
		SourceAssetID: assetID,
		Metaphor:      repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
		Semantic:      repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
		Clip:          repository.RecallConfig[pgvector.Vector]{Enabled: true, Limit: 10},
		OwnerID:       ownerID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to perform similarity search: %w", err)
	}

	if len(results) == 0 {
		return []model.SearchResult{}, nil
	}

	// 3. Assemble results (Enrich with views)
	assetIDs := make([]string, len(results))
	for i, r := range results {
		assetIDs[i] = r.AssetID
	}
	memeMap, err := s.GetMemeViews(ctx, assetIDs, ownerID)
	if err != nil {
		return nil, err
	}

	finalRes := make([]model.SearchResult, 0, len(results))
	for _, r := range results {
		meme, ok := memeMap[r.AssetID]
		if !ok {
			continue // Should not happen if DB is consistent
		}
		finalRes = append(finalRes, model.SearchResult{
			Meme:       meme,
			RecallType: r.RecallType,
			Score:      r.Similarity, // For similarity search, we use the vector similarity as score
			Similarity: r.Similarity,
		})
	}

	// Sort by similarity descending (it's already sorted by DB per asset, but we might have duplicates across channels)
	sort.Slice(finalRes, func(i, j int) bool {
		return finalRes[i].Similarity > finalRes[j].Similarity
	})

	// Truncate to requested limit
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
	OwnerID  string
	FolderID string
}

func (s *MemeService) Search(ctx context.Context, params SearchParams) ([]model.SearchResult, error) {
	var folderPath *string
	if params.FolderID != "" {
		node, err := s.repo.Node.GetNode(ctx, params.FolderID, params.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("failed to get folder node: %w", err)
		}
		folderPath = &node.Path
	}

	var textVec, clipTextVec, clipImageVec []float32
	g, gCtx := errgroup.WithContext(ctx)

	// 1. Get Embeddings in Parallel
	if params.Query != "" {
		g.Go(func() error {
			vec, err := s.inferClient.TextEmbedding(gCtx, params.Query, s.cfg.Prompt.Retrieval)
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

	// 2. Perform Combined DB Search
	imageMode := len(clipImageVec) > 0
	results, err := s.repo.Meme.SearchCombined(ctx, repository.SearchCombinedParams{
		ClipImage:  repository.RecallConfig[pgvector.Vector]{Enabled: imageMode, Value: pgvector.NewVector(clipImageVec), Limit: 50},
		Metaphor:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(textVec) > 0, Value: pgvector.NewVector(textVec), Limit: 15},
		Semantic:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(textVec) > 0, Value: pgvector.NewVector(textVec), Limit: 10},
		ClipText:   repository.RecallConfig[pgvector.Vector]{Enabled: !imageMode && len(clipTextVec) > 0, Value: pgvector.NewVector(clipTextVec), Limit: 15},
		OCR:        repository.RecallConfig[string]{Enabled: !imageMode && params.Query != "", Value: params.Query, Limit: 10},
		Scope:      params.Scope,
		OwnerID:    params.OwnerID,
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
		// 3. Prepare docs for reranking
		docs := make([]string, 0, len(results))
		for _, r := range results {
			out, err := inference.ParseVLMOutput(string(r.VLMJSON))
			if err != nil {
				slog.Warn("Failed to parse VLM output for rerank doc", "asset_id", r.AssetID, "error", err)
				continue
			}
			candidates = append(candidates, r)
			docs = append(docs, out.GetRerankDoc())
		}

		// 4. Rerank individually
		scores = make([]float32, len(candidates))
		rerankG, rerankCtx := errgroup.WithContext(ctx)
		for i, doc := range docs {
			rerankG.Go(func() error {
				score, err := s.inferClient.Rerank(rerankCtx, params.Query, doc, s.cfg.Prompt.Retrieval)
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
		// Skip rerank if query is empty
		for _, r := range results {
			candidates = append(candidates, r)
			scores = append(scores, r.Similarity)
		}
	}

	// 5. Assemble results in batch
	assetIDs := make([]string, len(candidates))
	for i, c := range candidates {
		assetIDs[i] = c.AssetID
	}
	memeMap, err := s.GetMemeViews(ctx, assetIDs, params.OwnerID)
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

	// Sort by rerank score descending
	sort.Slice(finalRes, func(i, j int) bool {
		return finalRes[i].Score > finalRes[j].Score
	})

	// Truncate to requested limit
	if params.Limit > 0 && len(finalRes) > params.Limit {
		finalRes = finalRes[:params.Limit]
	}

	return finalRes, nil
}

func (s *MemeService) GetMemeViews(ctx context.Context, assetIDs []string, ownerID string) (map[string]*model.MemeView, error) {
	var uid *string
	if ownerID != "" {
		uid = &ownerID
	}

	memes, err := s.repo.Meme.GetMemeViews(ctx, assetIDs, uid)
	if err != nil {
		return nil, err
	}

	// Fetch Favorites
	_, assetFavs, err := s.repo.Favorite.GetFavorites(ctx, ownerID, nil, assetIDs)
	if err != nil {
		return nil, err
	}

	// Fetch Tags (Decoupled)
	tagsMap, err := s.repo.Tag.GetTagsByAssets(ctx, assetIDs, uid)
	if err != nil {
		slog.Error("failed to fetch tags for memes", "error", err)
		// Non-fatal error for tags? Maybe better to return empty tags than failing everything
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

func (s *MemeService) GetMemeView(ctx context.Context, assetID string, ownerID string) (*model.MemeView, error) {
	memes, err := s.GetMemeViews(ctx, []string{assetID}, ownerID)
	if err != nil {
		return nil, err
	}
	meme, ok := memes[assetID]
	if !ok {
		return nil, apperror.NotFound(fmt.Sprintf("meme not found: %s", assetID))
	}
	return meme, nil
}

func (s *MemeService) RetryProcessing(ctx context.Context, assetIDs []string, ownerID string) error {
	if len(assetIDs) == 0 {
		return nil
	}

	memes, err := s.GetMemeViews(ctx, assetIDs, ownerID)
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
			continue // Skip non-failed memes for batch retry
		}
		validIDs = append(validIDs, id)
	}

	if len(validIDs) == 0 {
		return nil
	}

	err = s.repo.Transaction(ctx, func(r *repository.Repositories) error {
		if err := r.Meme.ResetMemeStatus(ctx, validIDs); err != nil {
			return fmt.Errorf("failed to reset meme status: %w", err)
		}

		// Create individual tasks for each retry to ensure background processing
		for _, id := range validIDs {
			_, err = r.Task.CreateTaskWithOpts(ctx, model.JobProcessMemes, map[string]any{
				"start_id":   id,
				"batch_size": s.cfg.Inference.BatchSize,
			}, &repository.TaskOpts{Priority: model.PriorityNormal})
			if err != nil {
				return fmt.Errorf("failed to create retry task for %s: %w", id, err)
			}
		}
		return nil
	})

	return err
}
