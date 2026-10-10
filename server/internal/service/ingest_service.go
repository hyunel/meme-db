package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/hyunel/MemeDB/internal/worker"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Notifier wakes the task worker once enqueued tasks are committed.
type Notifier interface {
	Notify()
}

// AnalyzeMemePayload is the payload of model.JobAnalyzeMeme tasks.
type AnalyzeMemePayload struct {
	AssetID string `json:"asset_id"`
}

// enqueueAnalysis schedules one analysis task per asset. Call it within the transaction
// that moves the memes to pending, so a pending meme always has a task.
func enqueueAnalysis(ctx context.Context, r *repository.Repos, priority int, assetIDs ...string) error {
	for _, id := range assetIDs {
		_, err := r.Task.CreateWithOpts(ctx, model.JobAnalyzeMeme, AnalyzeMemePayload{AssetID: id}, &repository.TaskOpts{Priority: priority})
		if err != nil {
			return fmt.Errorf("failed to enqueue analysis for %s: %w", id, err)
		}
	}
	return nil
}

type IngestServiceConfig struct {
	StoragePath     string
	CaptionPrompt   string
	RetrievalPrompt string
}

// IngestService handles model.JobAnalyzeMeme tasks: it analyzes a meme with the
// inference service and keeps meme_info.processing_status in sync with the task.
type IngestService struct {
	cfg         IngestServiceConfig
	repo        *repository.Provider
	inferClient inference.InferenceService
}

func NewIngestService(cfg IngestServiceConfig, repo *repository.Provider, inferClient inference.InferenceService) *IngestService {
	return &IngestService{cfg: cfg, repo: repo, inferClient: inferClient}
}

func (s *IngestService) Handle(ctx context.Context, task *model.Task) error {
	var payload AnalyzeMemePayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return worker.Permanent(fmt.Errorf("failed to unmarshal payload: %w", err))
	}

	if err := s.repo.Meme.UpdateStatus(ctx, payload.AssetID, model.ProcessingStatusProcessing); err != nil {
		return fmt.Errorf("failed to mark meme processing: %w", err)
	}

	asset, err := s.repo.Asset.Get(ctx, payload.AssetID)
	if err != nil {
		return err
	}
	if asset == nil {
		return worker.Permanent(fmt.Errorf("asset not found: %s", payload.AssetID))
	}

	if err := s.analyze(ctx, asset); err != nil {
		// Retrying cannot fix a missing file or an image the inference service rejects.
		// Everything else is retried, including malformed VLM JSON (LLM output is nondeterministic).
		if errors.Is(err, fs.ErrNotExist) || status.Code(err) == codes.InvalidArgument {
			return worker.Permanent(err)
		}
		return err
	}
	return nil
}

func (s *IngestService) OnFailure(ctx context.Context, task *model.Task, _ error) error {
	var payload AnalyzeMemePayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return nil // No meme to mark
	}
	return s.repo.Meme.UpdateStatus(ctx, payload.AssetID, model.ProcessingStatusFailed)
}

func (s *IngestService) analyze(ctx context.Context, asset *model.Asset) error {
	fileBytes, err := os.ReadFile(filepath.Join(s.cfg.StoragePath, asset.StoragePath))
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	res, err := s.inferClient.ImageCaption(ctx, s.cfg.CaptionPrompt, inference.ImageInput{
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

	var metaphorEmb, semanticEmb []float32
	g, gCtx := errgroup.WithContext(ctx)
	g.Go(func() error {
		emb, err := s.inferClient.TextEmbedding(gCtx, vlmOut.GetMetaphorText(), s.cfg.RetrievalPrompt)
		if err != nil {
			return fmt.Errorf("failed to get metaphor embedding: %w", err)
		}
		metaphorEmb = emb
		return nil
	})
	g.Go(func() error {
		emb, err := s.inferClient.TextEmbedding(gCtx, vlmOut.GetSemanticText(), s.cfg.RetrievalPrompt)
		if err != nil {
			return fmt.Errorf("failed to get semantic embedding: %w", err)
		}
		semanticEmb = emb
		return nil
	})
	if err := g.Wait(); err != nil {
		return err
	}

	now := time.Now()
	metaphorVec := pgvector.NewVector(metaphorEmb)
	semanticVec := pgvector.NewVector(semanticEmb)
	clipVec := pgvector.NewVector(res.ClipEmbedding)
	return s.repo.Meme.Create(ctx, &model.MemeInfo{
		AssetID:          asset.ID,
		VLMJSON:          json.RawMessage(res.Caption),
		OCRText:          &vlmOut.OCRText,
		MetaphorVector:   &metaphorVec,
		SemanticVector:   &semanticVec,
		ClipVector:       &clipVec,
		Width:            res.Width,
		Height:           res.Height,
		ProcessingStatus: model.ProcessingStatusSuccess,
		AnalyzedAt:       &now,
	})
}
