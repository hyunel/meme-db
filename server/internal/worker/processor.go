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
	"golang.org/x/sync/errgroup"
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

	if payload.BatchSize <= 0 {
		return fmt.Errorf("invalid batch size: %d", payload.BatchSize)
	}

	// 1. Fetch a batch of pending memes (+1 for next StartID)
	memes, err := h.repo.Meme.GetPending(ctx, payload.StartID, payload.BatchSize)
	if err != nil {
		return fmt.Errorf("failed to get pending memes: %w", err)
	}

	if len(memes) == 0 {
		return nil
	}

	// If more than batch size, there will be a next batch to process
	toProcess := memes
	var nextStartID string
	if len(memes) > payload.BatchSize {
		toProcess = memes[:payload.BatchSize]
		nextStartID = memes[payload.BatchSize].AssetID
	}

	// 2. Process memes concurrently
	g, gCtx := errgroup.WithContext(ctx)
	for _, m := range toProcess {
		g.Go(func() error {
			if err := h.processMeme(gCtx, m); err != nil {
				slog.Error("Meme processing failed", "asset_id", m.AssetID, "error", err)
				_ = h.repo.Meme.UpdateStatus(ctx, m.AssetID, model.ProcessingStatusFailed)
			}
			return nil
		})
	}

	_ = g.Wait()

	// 3. Update payload for next run
	if payload.ShouldReschedule && nextStartID != "" {
		payload.StartID = nextStartID
		newPayload, _ := json.Marshal(payload)
		task.Payload = newPayload
		return ErrRescheduled
	}

	return nil
}

func (h *ProcessMemesHandler) processMeme(ctx context.Context, meme *model.MemeInfo) error {
	// 1. Prepare item
	asset, err := h.repo.Asset.Get(ctx, meme.AssetID)
	if err != nil {
		return fmt.Errorf("failed to get asset: %w", err)
	}
	if asset == nil {
		return fmt.Errorf("asset not found: %s", meme.AssetID)
	}

	absPath := filepath.Join(h.cfg.Server.StoragePath, asset.StoragePath)
	fileBytes, err := os.ReadFile(absPath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	// 2. Get Image Caption
	res, err := h.inferClient.ImageCaption(ctx, h.cfg.Prompt.Caption, inference.ImageInput{
		Data:   fileBytes,
		Format: asset.Extension,
	})
	if err != nil {
		return fmt.Errorf("failed to get image caption: %w", err)
	}

	vlmOut, err := inference.ParseVLMOutput(res.Caption)
	if err != nil {
		return fmt.Errorf("failed to parse VLM output: %w", err)
	}

	// 3. Get Embeddings
	metaphorText := vlmOut.GetMetaphorText()
	semanticText := vlmOut.GetSemanticText()

	metaphorEmb, err := h.inferClient.TextEmbedding(ctx, metaphorText, h.cfg.Prompt.Retrieval)
	if err != nil {
		return fmt.Errorf("failed to get metaphor embedding: %w", err)
	}

	semanticEmb, err := h.inferClient.TextEmbedding(ctx, semanticText, h.cfg.Prompt.Retrieval)
	if err != nil {
		return fmt.Errorf("failed to get semantic embedding: %w", err)
	}

	// 4. Update and save meme
	now := time.Now()
	meme.MetaphorVector = ptr(pgvector.NewVector(metaphorEmb))
	meme.SemanticVector = ptr(pgvector.NewVector(semanticEmb))
	meme.ClipVector = ptr(pgvector.NewVector(res.ClipEmbedding))
	meme.VLMJSON = json.RawMessage(res.Caption)
	meme.OCRText = &vlmOut.OCRText
	meme.Width = res.Width
	meme.Height = res.Height
	meme.ProcessingStatus = model.ProcessingStatusSuccess
	meme.AnalyzedAt = &now

	if err := h.repo.Meme.Create(ctx, meme); err != nil {
		return fmt.Errorf("failed to update meme in repo: %w", err)
	}

	return nil
}

func ptr[T any](v T) *T {
	return &v
}
