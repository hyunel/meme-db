package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
)

type MemeService struct {
	cfg         *config.Config
	repo        *repository.Provider
	inferClient inference.InferenceService
}

func NewMemeService(
	cfg *config.Config,
	repo *repository.Provider,
	inferClient inference.InferenceService,
) *MemeService {
	return &MemeService{
		cfg:         cfg,
		repo:        repo,
		inferClient: inferClient,
	}
}

func (s *MemeService) IngestMeme(ctx context.Context, fileHeader *multipart.FileHeader) (*model.Asset, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// 1. Calculate Hash
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return nil, fmt.Errorf("failed to hash file: %w", err)
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	// 2. Check if asset exists
	existing, err := s.repo.Asset.GetAssetByHash(ctx, hash)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	// 3. Save file to storage
	file.Seek(0, 0)

	ext := filepath.Ext(fileHeader.Filename)
	relPath := filepath.Join(hash[:2], hash[2:4], hash[4:]+ext)
	absPath := filepath.Join(s.cfg.Server.StoragePath, relPath)

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	dst, err := os.Create(absPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	var asset *model.Asset
	err = s.repo.Transaction(ctx, func(r *repository.Repositories) error {
		// a. Create Asset Record
		asset = &model.Asset{
			FileHash:    hash,
			FileSize:    fileHeader.Size,
			MimeType:    fileHeader.Header.Get("Content-Type"),
			Extension:   ext,
			StoragePath: relPath,
		}
		if err := r.Asset.CreateAsset(ctx, asset); err != nil {
			return err
		}

		// b. Create MemeInfo Stub
		memeInfo := &model.MemeInfo{
			AssetID: asset.ID,
		}
		if err := r.Meme.CreateMeme(ctx, memeInfo); err != nil {
			return fmt.Errorf("failed to create meme info stub: %w", err)
		}

		// c. Trigger Processing Task
		_, err = r.Task.CreateTaskWithOpts(ctx, model.JobProcessMemes, map[string]string{
			"start_id": asset.ID,
		}, &repository.TaskOpts{Priority: 10})
		if err != nil {
			return fmt.Errorf("failed to create processing task: %w", err)
		}

		return nil
	})

	if err != nil {
		os.Remove(absPath)
		return nil, err
	}

	return asset, nil
}

func (s *MemeService) TriggerFixMissing(ctx context.Context) (string, error) {
	task, err := s.repo.Task.CreateTaskWithOpts(ctx, model.JobProcessMemes, map[string]string{
		"start_id": "",
	}, &repository.TaskOpts{Priority: 0})
	if err != nil {
		return "", fmt.Errorf("failed to create process task: %w", err)
	}
	return task.ID, nil
}

func (s *MemeService) Search(ctx context.Context, query string, limit int, scope string, ownerID string, folderID string) ([]repository.SearchResult, error) {
	var folderPath *string
	if folderID != "" {
		node, err := s.repo.Node.GetNode(ctx, folderID, ownerID)
		if err == nil {
			folderPath = &node.Path
		}
	}
	return s.repo.Meme.SearchByOCR(ctx, query, limit, scope, ownerID, folderPath)
}

func (s *MemeService) FullSearch(
	ctx context.Context,
	query string,
	limit int,
	scope string,
	ownerID string,
	folderID string,
) ([]map[string]interface{}, error) {
	var folderPath *string
	if folderID != "" {
		node, err := s.repo.Node.GetNode(ctx, folderID, ownerID)
		if err == nil {
			folderPath = &node.Path
		}
	}

	metaVecs, err := s.inferClient.TextEmbedding(ctx, []string{query}, "search_query")
	if err != nil {
		return nil, err
	}
	clipVecs, err := s.inferClient.ClipTextEmbedding(ctx, []string{query})
	if err != nil {
		return nil, err
	}

	resMeta, _ := s.repo.Meme.SearchByVector(ctx, "metaphor_vector", pgvector.NewVector(metaVecs[0]), limit, scope, ownerID, folderPath)
	resSem, _ := s.repo.Meme.SearchByVector(ctx, "semantic_vector", pgvector.NewVector(metaVecs[0]), limit, scope, ownerID, folderPath)
	resClip, _ := s.repo.Meme.SearchByVector(ctx, "clip_vector", pgvector.NewVector(clipVecs[0]), limit, scope, ownerID, folderPath)
	resOCR, _ := s.repo.Meme.SearchByOCR(ctx, query, limit, scope, ownerID, folderPath)

	seen := make(map[string]repository.SearchResult)
	for _, r := range resMeta {
		seen[r.AssetID] = r
	}
	for _, r := range resSem {
		seen[r.AssetID] = r
	}
	for _, r := range resClip {
		seen[r.AssetID] = r
	}
	for _, r := range resOCR {
		seen[r.AssetID] = r
	}

	candidates := make([]repository.SearchResult, 0, len(seen))
	docs := make([]string, 0, len(seen))
	for _, r := range seen {
		candidates = append(candidates, r)
		doc := ""
		if r.OCRText != nil {
			doc += *r.OCRText
		}
		docs = append(docs, doc)
	}

	if len(candidates) == 0 {
		return nil, nil
	}

	scores, err := s.inferClient.Rerank(ctx, query, docs, "rerank")
	if err != nil {
		return nil, err
	}

	type RankedResult struct {
		Result repository.SearchResult
		Score  float32
	}
	ranked := make([]RankedResult, len(candidates))
	for i, c := range candidates {
		ranked[i] = RankedResult{Result: c, Score: scores[i]}
	}

	finalRes := make([]map[string]interface{}, len(ranked))
	for i, r := range ranked {
		finalRes[i] = map[string]interface{}{
			"asset_id":   r.Result.AssetID,
			"score":      r.Score,
			"ocr_text":   r.Result.OCRText,
			"similarity": r.Result.Similarity,
		}
	}

	return finalRes, nil
}
