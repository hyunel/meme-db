package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

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
	StartID   string `json:"start_id"`
	BatchSize int    `json:"batch_size"`
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
		batchSize = 8 // Default batch size
	}

	var shouldReschedule bool

	// Transaction wrapper
	err := h.repo.Transaction(ctx, func(r *repository.Repositories) error {
		// 1. Fetch pending memes (locked)
		memes, err := r.Meme.GetPendingMemesForUpdate(ctx, payload.StartID, batchSize)
		if err != nil {
			return fmt.Errorf("failed to get pending memes: %w", err)
		}

		if len(memes) == 0 {
			return nil
		}

		// 2. Process batch
		if err := h.processBatch(ctx, r, memes); err != nil {
			return fmt.Errorf("batch processing failed: %w", err)
		}

		// 3. Update payload for next run if full batch
		if len(memes) == batchSize {
			lastID := memes[len(memes)-1].AssetID
			payload.StartID = lastID
			newPayload, _ := json.Marshal(payload)
			task.Payload = newPayload
			shouldReschedule = true
		}
		return nil
	})

	if err != nil {
		return err
	}

	if shouldReschedule {
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

func (h *ProcessMemesHandler) processBatch(ctx context.Context, r *repository.Repositories, items []*model.MemeInfo) error {
	if len(items) == 0 {
		return nil
	}

	batchData := make([]*processedItem, 0, len(items))
	for _, meme := range items {
		pm, err := h.prepareItem(ctx, r, meme)
		if err != nil {
			slog.Error("Failed to prepare meme for batch processing", "asset_id", meme.AssetID, "error", err)
			continue
		}
		batchData = append(batchData, pm)
	}

	if len(batchData) == 0 {
		return nil
	}

	inputs := make([]inference.AnalyzeInput, len(batchData))
	for i, pm := range batchData {
		inputs[i] = inference.AnalyzeInput{
			Image: inference.ImageInput{
				Data:   pm.FileBytes,
				Format: pm.FileExt,
			},
			VlmJson: pm.VlmJson,
		}
	}

	// TODO: Inference is called inside DB transaction, this is suboptimal.
	results, err := h.inferClient.AnalyzeImage(ctx, inputs)
	if err != nil {
		return fmt.Errorf("failed to analyze images batch: %w", err)
	}

	if len(results) != len(batchData) {
		return fmt.Errorf("mismatch in results count: expected %d, got %d", len(batchData), len(results))
	}

	for i, pm := range batchData {
		res := results[i]
		pm.Meme.MetaphorVector = pgvector.NewVector(res.MetaphorVector)
		pm.Meme.SemanticVector = pgvector.NewVector(res.SemanticVector)
		pm.Meme.ClipVector = pgvector.NewVector(res.ClipVector)
		pm.Meme.VLMJSON = json.RawMessage(res.VlmJson)
		pm.Meme.OCRText = &res.OcrText
		pm.Meme.Width = res.Width
		pm.Meme.Height = res.Height

		if err := r.Meme.CreateMeme(ctx, pm.Meme); err != nil {
			slog.Error("Failed to save meme result", "asset_id", pm.Meme.AssetID, "error", err)
		} else {
			slog.Info("Meme processed successfully", "asset_id", pm.Meme.AssetID)
		}
	}

	return nil
}

func (h *ProcessMemesHandler) prepareItem(ctx context.Context, r *repository.Repositories, meme *model.MemeInfo) (*processedItem, error) {
	asset, err := r.Asset.GetAsset(ctx, meme.AssetID)
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
