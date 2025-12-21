package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
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
	if params.Limit <= 0 {
		params.Limit = 10
	}

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

	const task = "Given user query keywords, retrieve the most relevant paragraphs"

	// 1. Get Embeddings in Parallel
	g.Go(func() error {
		vecs, err := s.inferClient.TextEmbedding(gCtx, []string{params.Query}, task)
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
		Metaphor:   repository.RecallConfig[pgvector.Vector]{Value: pgvector.NewVector(metaVec)},
		Semantic:   repository.RecallConfig[pgvector.Vector]{Value: pgvector.NewVector(metaVec)},
		Clip:       repository.RecallConfig[pgvector.Vector]{Value: pgvector.NewVector(clipVec)},
		OCR:        repository.RecallConfig[string]{Value: params.Query},
		Limit:      params.Limit,
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
		doc := ""
		if r.OCRText != nil {
			doc += *r.OCRText
		}
		docs = append(docs, doc)
	}

	// 4. Rerank
	scores, err := s.inferClient.Rerank(ctx, params.Query, docs, task)
	if err != nil {
		return nil, fmt.Errorf("failed to rerank: %w", err)
	}

	finalRes := make([]model.SearchResult, len(candidates))
	for i, c := range candidates {
		dto, err := s.assembleMemeDTO(ctx, c.MemeInfo, params.OwnerID)
		if err != nil {
			return nil, err
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
	if len(finalRes) > params.Limit {
		finalRes = finalRes[:params.Limit]
	}

	return finalRes, nil
}

func (s *MemeService) assembleMemeDTO(ctx context.Context, info model.MemeInfo, ownerID string) (*model.MemeDTO, error) {
	var userIDPtr *string
	if ownerID != "" {
		userIDPtr = &ownerID
	}
	tags, err := s.repo.Tag.GetAssetTags(ctx, info.AssetID, userIDPtr)
	if err != nil {
		return nil, err
	}

	asset, err := s.repo.Asset.GetAsset(ctx, info.AssetID)
	if err != nil {
		return nil, err
	}
	var url *string
	if asset != nil {
		u := s.assetService.GetAssetURL(info.AssetID)
		url = &u
	}

	return &model.MemeDTO{
		AssetID:    info.AssetID,
		Width:      info.Width,
		Height:     info.Height,
		Tags:       tags,
		URL:        url,
		AnalyzedAt: info.AnalyzedAt,
	}, nil
}
