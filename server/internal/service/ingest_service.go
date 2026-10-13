package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
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

type Notifier interface {
	Notify()
}

type AnalyzeMemePayload struct {
	AssetID string `json:"asset_id"`
}

// enqueueAnalysis must run in the transaction that sets the memes pending, so a pending meme always has a task.
func enqueueAnalysis(ctx context.Context, r *repository.Repos, priority int, assetIDs ...string) error {
	payloads := make([]any, len(assetIDs))
	for i, id := range assetIDs {
		payloads[i] = AnalyzeMemePayload{AssetID: id}
	}
	if err := r.Task.Enqueue(ctx, model.JobAnalyzeMeme, payloads, repository.TaskOpts{Priority: priority}); err != nil {
		return fmt.Errorf("failed to enqueue analysis: %w", err)
	}
	return nil
}

type IngestServiceConfig struct {
	StoragePath     string
	CaptionPrompt   string
	RetrievalPrompt string
}

type IngestService struct {
	cfg         IngestServiceConfig
	repo        *repository.Provider
	inferClient inference.InferenceService
	tags        *TagService
}

func NewIngestService(cfg IngestServiceConfig, repo *repository.Provider, inferClient inference.InferenceService, tags *TagService) *IngestService {
	return &IngestService{cfg: cfg, repo: repo, inferClient: inferClient, tags: tags}
}

func (s *IngestService) Handle(ctx context.Context, task *model.Task) error {
	var payload AnalyzeMemePayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return worker.Permanent(fmt.Errorf("failed to unmarshal payload: %w", err))
	}

	if err := s.repo.Meme.SetStatus(ctx, payload.AssetID, model.ProcessingStatusProcessing, nil); err != nil {
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
		// A missing file or a rejected image never recovers; anything else, even malformed VLM JSON, may.
		if errors.Is(err, fs.ErrNotExist) || status.Code(err) == codes.InvalidArgument {
			return worker.Permanent(err)
		}
		return err
	}
	return nil
}

func (s *IngestService) OnFailure(ctx context.Context, task *model.Task, cause error) error {
	return s.setStatus(ctx, task, model.ProcessingStatusFailed, cause)
}

func (s *IngestService) OnRequeue(ctx context.Context, task *model.Task) error {
	return s.setStatus(ctx, task, model.ProcessingStatusPending, nil)
}

func (s *IngestService) setStatus(ctx context.Context, task *model.Task, status string, cause error) error {
	var payload AnalyzeMemePayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return nil // No meme to update
	}
	var reason *string
	if cause != nil {
		msg := cause.Error()
		reason = &msg
	}
	return s.repo.Meme.SetStatus(ctx, payload.AssetID, status, reason)
}

func (s *IngestService) analyze(ctx context.Context, asset *model.Asset) error {
	fileBytes, err := os.ReadFile(filepath.Join(s.cfg.StoragePath, asset.StoragePath))
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	res, err := s.inferClient.AnalyzeImage(ctx, inference.ImageInput{
		Data:   fileBytes,
		Format: asset.Extension,
	}, s.cfg.CaptionPrompt)
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

	labels, err := s.tags.Resolve(ctx, systemTags(vlmOut), false)
	if err != nil {
		return err
	}

	now := time.Now()
	metaphorVec := pgvector.NewVector(metaphorEmb)
	semanticVec := pgvector.NewVector(semanticEmb)
	clipVec := pgvector.NewVector(res.ClipEmbedding)
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		err := r.Meme.Create(ctx, &model.MemeInfo{
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
		if err != nil {
			return err
		}
		return r.Tag.SetSystemLabels(ctx, asset.ID, labels)
	})
}

func systemTags(out *inference.VLMOutput) []string {
	seen := make(map[string]bool)
	var tags []string
	for _, t := range out.Tags {
		t = strings.TrimSpace(t)
		if key := strings.ToLower(t); t != "" && len(t) <= 100 && !seen[key] {
			seen[key] = true
			tags = append(tags, t)
		}
	}
	return tags
}
