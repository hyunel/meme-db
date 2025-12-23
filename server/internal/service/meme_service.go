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

type SearchParams struct {
	Query    string
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

	var metaVec, clipVec []float32
	g, gCtx := errgroup.WithContext(ctx)

	// 1. Get Embeddings in Parallel
	g.Go(func() error {
		vecs, err := s.inferClient.TextEmbedding(gCtx, []string{params.Query}, s.cfg.Prompt.Retrieval)
		if err != nil {
			return err
		}
		metaVec = vecs[0]
		return nil
	})

	g.Go(func() error {
		vecs, err := s.inferClient.ClipTextEmbedding(gCtx, []string{params.Query})
		if err != nil {
			return err
		}
		clipVec = vecs[0]
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to get embeddings: %w", err)
	}

	// 2. Perform Combined DB Search
	results, err := s.repo.Meme.SearchCombined(ctx, repository.SearchCombinedParams{
		Metaphor:   repository.RecallConfig[pgvector.Vector]{Enabled: true, Value: pgvector.NewVector(metaVec), Limit: 10},
		Semantic:   repository.RecallConfig[pgvector.Vector]{Enabled: true, Value: pgvector.NewVector(metaVec), Limit: 10},
		Clip:       repository.RecallConfig[pgvector.Vector]{Enabled: true, Value: pgvector.NewVector(clipVec), Limit: 10},
		OCR:        repository.RecallConfig[string]{Enabled: true, Value: params.Query, Limit: 20},
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

	candidates := make([]repository.SearchResult, 0, len(results))

	docs := make([]string, 0, len(results))
	for _, r := range results {
		candidates = append(candidates, r)

		out, err := inference.ParseVLMOutput(string(r.VLMJSON))
		if err != nil {
			slog.Warn("Failed to parse VLM output for rerank doc", "asset_id", r.AssetID, "error", err)
			continue
		}
		docs = append(docs, out.GetRerankDoc())
	}

	// 4. Rerank
	// The inferClient handles batching internally based on configuration
	scores, err := s.inferClient.Rerank(ctx, params.Query, docs, s.cfg.Prompt.Retrieval)
	if err != nil {
		return nil, fmt.Errorf("failed to rerank: %w", err)
	}

	// 5. Assemble DTOs in batch
	assetIDs := make([]string, len(candidates))
	for i, c := range candidates {
		assetIDs[i] = c.AssetID
	}
	dtoMap, err := s.BatchAssembleMemeDTOs(ctx, assetIDs, params.OwnerID)
	if err != nil {
		return nil, err
	}

	finalRes := make([]model.SearchResult, len(candidates))
	for i, c := range candidates {
		dto, ok := dtoMap[c.AssetID]
		if !ok {
			return nil, fmt.Errorf("missing meme dto for asset %s", c.AssetID)
		}

		finalRes[i] = model.SearchResult{
			Meme:       dto,
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

func (s *MemeService) AssembleMemeDTO(ctx context.Context, assetID string, ownerID string) (*model.MemeDTO, error) {
	dtos, err := s.BatchAssembleMemeDTOs(ctx, []string{assetID}, ownerID)
	if err != nil {
		return nil, err
	}
	dto, ok := dtos[assetID]
	if !ok {
		return nil, apperror.NotFound(fmt.Sprintf("meme not found: %s", assetID))
	}
	return dto, nil
}

func (s *MemeService) BatchAssembleMemeDTOs(ctx context.Context, assetIDs []string, ownerID string) (map[string]*model.MemeDTO, error) {
	dtoMap, err := s.repo.Meme.GetMemeDTOs(ctx, assetIDs, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to assemble meme dtos: %w", err)
	}

	for assetID, dto := range dtoMap {
		u := s.assetService.GetAssetURL(assetID)
		dto.URL = &u
	}

	return dtoMap, nil
}
