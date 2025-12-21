package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
)

type ProcessMemesHandler struct {
	cfg         *config.Config
	repo        *repository.Provider
	inferClient *inference.Client
}

func NewProcessMemesHandler(
	cfg *config.Config,
	repo *repository.Provider,
	inferClient *inference.Client,
) *ProcessMemesHandler {
	return &ProcessMemesHandler{
		cfg:         cfg,
		repo:        repo,
		inferClient: inferClient,
	}
}

type ProcessPayload struct {
	StartID          string `json:"start_id"`
	BatchSize        int    `json:"batch_size"`
	ShouldReschedule bool   `json:"should_reschedule"`
}

func (h *ProcessMemesHandler) Handle(ctx context.Context, task *model.Task) error {
	var payload ProcessPayload
	if len(task.Payload) > 0 {
		if err := json.Unmarshal(task.Payload, &payload); err != nil {
			return fmt.Errorf("failed to unmarshal payload: %w", err)
		}
	}

	batchSize := payload.BatchSize
	if batchSize <= 0 {
		return fmt.Errorf("invalid batch size: %d", batchSize)
	}

	var shouldReschedule bool

	// 1. Fetch pending memes
	memes, err := h.repo.Meme.GetPendingMemesForUpdate(ctx, payload.StartID, batchSize)
	if err != nil {
		return fmt.Errorf("failed to get pending memes: %w", err)
	}

	if len(memes) == 0 {
		return nil
	}

	// 2. Process batch
	if err := h.processBatch(ctx, memes); err != nil {
		slog.Error("Batch processing failed", "error", err)
	}

	// 3. Update payload for next run if full batch
	if len(memes) == batchSize {
		lastID := memes[len(memes)-1].AssetID
		payload.StartID = lastID
		newPayload, _ := json.Marshal(payload)
		task.Payload = newPayload
		shouldReschedule = true
	}

	if shouldReschedule && payload.ShouldReschedule {
		return ErrRescheduled
	}

	return nil
}

type processedItem struct {
	Meme      *model.MemeInfo
	FileBytes []byte
	FileExt   string
	VlmJson   string
}

func (h *ProcessMemesHandler) processBatch(ctx context.Context, items []*model.MemeInfo) error {
	if len(items) == 0 {
		return nil
	}

	batchData := make([]*processedItem, 0, len(items))
	for _, meme := range items {
		item, err := h.prepareItem(ctx, meme)
		if err != nil {
			slog.Error("Failed to prepare meme for processing", "asset_id", meme.AssetID, "error", err)
			continue
		}
		batchData = append(batchData, item)
	}

	if len(batchData) == 0 {
		return nil
	}

	// imageInputs := make([]inference.ImageInput, len(batchData))
	// for i, item := range batchData {
	// 	imageInputs[i] = inference.ImageInput{
	// 		Data:   item.FileBytes,
	// 		Format: item.FileExt,
	// 	}
	// }

	// results, err := h.inferClient.ImageCaption(ctx, h.cfg.Prompt.Caption, imageInputs)
	// if err != nil {
	// 	return fmt.Errorf("failed to get image captions: %w", err)
	// }

	// 1. Get Image Caption and Parse concurrently
	type result struct {
		item    *processedItem
		caption *inference.ImageCaptionResult
		vlmOut  *inference.VLMOutput
	}
	resultChan := make(chan result, len(batchData))
	errChan := make(chan error, len(batchData))

	for _, item := range batchData {
		go func(item *processedItem) {
			imageInput := inference.ImageInput{
				Data:   item.FileBytes,
				Format: item.FileExt,
			}
			res, err := h.inferClient.ImageCaption(ctx, h.cfg.Prompt.Caption, []inference.ImageInput{imageInput})
			if err != nil || len(res) == 0 {
				errChan <- fmt.Errorf("failed to get caption for %s: %w", item.Meme.AssetID, err)
				return
			}

			vlmOut, err := inference.ParseVLMOutput(res[0].Caption)
			if err != nil {
				errChan <- fmt.Errorf("failed to parse VLM output for %s: %w", item.Meme.AssetID, err)
				return
			}

			resultChan <- result{item: item, caption: res[0], vlmOut: vlmOut}
		}(item)
	}

	// 2. Collect successful results
	successfulItems := make([]*processedItem, 0, len(batchData))
	successfulCaptions := make([]*inference.ImageCaptionResult, 0, len(batchData))
	ocrTexts := make([]string, 0, len(batchData))
	metaphorTexts := make([]string, 0, len(batchData))
	semanticTexts := make([]string, 0, len(batchData))

	for i := 0; i < len(batchData); i++ {
		select {
		case res := <-resultChan:
			successfulItems = append(successfulItems, res.item)
			successfulCaptions = append(successfulCaptions, res.caption)
			ocrTexts = append(ocrTexts, res.vlmOut.OCRText)
			metaphorTexts = append(metaphorTexts, res.vlmOut.GetMetaphorText())
			semanticTexts = append(semanticTexts, res.vlmOut.GetSemanticText())
		case err := <-errChan:
			slog.Warn("Skipping meme due to processing error", "error", err)
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	if len(successfulItems) == 0 {
		return nil
	}

	// 3. Get Metaphor and Semantic embeddings for valid items in batch
	metaphorEmbs, err := h.inferClient.TextEmbedding(ctx, metaphorTexts, h.cfg.Prompt.Retrieval)
	if err != nil {
		return fmt.Errorf("failed to get metaphor embeddings: %w", err)
	}
	semanticEmbs, err := h.inferClient.TextEmbedding(ctx, semanticTexts, h.cfg.Prompt.Retrieval)
	if err != nil {
		return fmt.Errorf("failed to get semantic embeddings: %w", err)
	}

	// 4. Update and save memes
	now := time.Now()
	for i, item := range successfulItems {
		res := successfulCaptions[i]

		item.Meme.MetaphorVector = ptr(pgvector.NewVector(metaphorEmbs[i]))
		item.Meme.SemanticVector = ptr(pgvector.NewVector(semanticEmbs[i]))
		item.Meme.ClipVector = ptr(pgvector.NewVector(res.ClipEmbedding))
		item.Meme.VLMJSON = json.RawMessage(res.Caption)
		item.Meme.OCRText = &ocrTexts[i]
		item.Meme.Width = res.Width
		item.Meme.Height = res.Height
		item.Meme.AnalyzedAt = &now

		if err := h.repo.Meme.CreateMeme(ctx, item.Meme); err != nil {
			slog.Error("Failed to update meme", "error", err)
		}
	}

	return nil
}

func ptr[T any](v T) *T {
	return &v
}

func (h *ProcessMemesHandler) prepareItem(ctx context.Context, meme *model.MemeInfo) (*processedItem, error) {
	asset, err := h.repo.Asset.GetAsset(ctx, meme.AssetID)
	if err != nil {
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}
	if asset == nil {
		return nil, fmt.Errorf("asset not found: %s", meme.AssetID)
	}

	absPath := filepath.Join(h.cfg.Server.StoragePath, asset.StoragePath)
	fileBytes, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	vlmJson := ""
	if meme.VLMJSON != nil {
		vlmJson = string(meme.VLMJSON)
	}

	return &processedItem{
		Meme:      meme,
		FileBytes: fileBytes,
		FileExt:   asset.Extension,
		VlmJson:   vlmJson,
	}, nil
}
