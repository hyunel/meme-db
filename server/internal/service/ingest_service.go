package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/storage"
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

// MemePayload names the meme a task works on.
type MemePayload struct {
	AssetID string `json:"asset_id"`
	Caption string `json:"caption,omitempty"` // Analysis only: VLM output an admin uploaded with the file, used instead of captioning it
}

// enqueueMemeTasks must run in the transaction that sets the memes pending for an analysis, so a pending meme always has a task.
func enqueueMemeTasks(ctx context.Context, r *repository.Repos, job string, opts repository.TaskOpts, assetIDs ...string) error {
	payloads := make([]any, len(assetIDs))
	for i, id := range assetIDs {
		payloads[i] = MemePayload{AssetID: id}
	}
	if err := r.Task.Enqueue(ctx, job, payloads, opts); err != nil {
		return fmt.Errorf("failed to enqueue %s: %w", job, err)
	}
	return nil
}

func memePayload(task *model.Task) (*MemePayload, error) {
	var payload MemePayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return nil, worker.Permanent(fmt.Errorf("failed to unmarshal payload: %w", err))
	}
	return &payload, nil
}

// hopeless makes permanent the errors no retry recovers from: a missing file, or an image the inference service rejects.
func hopeless(err error) error {
	if errors.Is(err, fs.ErrNotExist) || status.Code(err) == codes.InvalidArgument {
		return worker.Permanent(err)
	}
	return err
}

type IngestServiceConfig struct {
	CaptionPrompt   string
	RetrievalPrompt string
}

type IngestService struct {
	cfg         IngestServiceConfig
	repo        *repository.Provider
	files       storage.Storage
	inferClient inference.InferenceService
	tags        *TagService
}

func NewIngestService(cfg IngestServiceConfig, repo *repository.Provider, files storage.Storage, inferClient inference.InferenceService, tags *TagService) *IngestService {
	return &IngestService{cfg: cfg, repo: repo, files: files, inferClient: inferClient, tags: tags}
}

func (s *IngestService) Handle(ctx context.Context, task *model.Task) error {
	payload, err := memePayload(task)
	if err != nil {
		return err
	}
	if err := s.repo.Meme.SetStatus(ctx, payload.AssetID, model.ProcessingStatusProcessing, nil); err != nil {
		return fmt.Errorf("failed to mark meme processing: %w", err)
	}
	asset, data, err := s.file(ctx, payload.AssetID)
	if err != nil {
		return hopeless(err)
	}
	return hopeless(s.analyze(ctx, asset, data, payload.Caption)) // Anything else, even malformed VLM JSON, may recover
}

// EmbedClip rebuilds a meme's CLIP embedding; the meme stays searchable meanwhile.
func (s *IngestService) EmbedClip(ctx context.Context, task *model.Task) error {
	payload, err := memePayload(task)
	if err != nil {
		return err
	}
	asset, data, err := s.file(ctx, payload.AssetID)
	if err != nil {
		return hopeless(err)
	}
	emb, err := s.inferClient.ClipImageEmbedding(ctx, inference.ImageInput{Data: data, Format: asset.Extension})
	if err != nil {
		return hopeless(fmt.Errorf("failed to get CLIP embedding: %w", err))
	}
	return s.repo.Meme.SetClipVector(ctx, asset.ID, pgvector.NewVector(emb))
}

// EmbedText rebuilds a meme's text embeddings from its stored VLM output.
func (s *IngestService) EmbedText(ctx context.Context, task *model.Task) error {
	payload, err := memePayload(task)
	if err != nil {
		return err
	}
	captions, err := s.repo.Meme.Captions(ctx, []string{payload.AssetID})
	if err != nil {
		return err
	}
	vlmOut, err := inference.ParseVLMOutput(string(captions[payload.AssetID]))
	if err != nil {
		return worker.Permanent(fmt.Errorf("no usable VLM output: %w", err))
	}
	metaphor, semantic, err := s.textEmbeddings(ctx, vlmOut)
	if err != nil {
		return err
	}
	return s.repo.Meme.SetTextVectors(ctx, payload.AssetID, pgvector.NewVector(metaphor), pgvector.NewVector(semantic))
}

func (s *IngestService) file(ctx context.Context, assetID string) (*model.Asset, []byte, error) {
	asset, err := s.repo.Asset.Get(ctx, assetID)
	if err != nil {
		return nil, nil, err
	}
	if asset == nil {
		return nil, nil, worker.Permanent(fmt.Errorf("asset not found: %s", assetID))
	}
	f, err := s.files.Open(ctx, asset.StoragePath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read file: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read file: %w", err)
	}
	return asset, data, nil
}

func (s *IngestService) OnFailure(ctx context.Context, task *model.Task, cause error) error {
	return s.setStatus(ctx, task, model.ProcessingStatusFailed, cause)
}

func (s *IngestService) OnRequeue(ctx context.Context, task *model.Task) error {
	return s.setStatus(ctx, task, model.ProcessingStatusPending, nil)
}

func (s *IngestService) setStatus(ctx context.Context, task *model.Task, status string, cause error) error {
	payload, err := memePayload(task)
	if err != nil {
		return nil // No meme to update
	}
	var reason *string
	if cause != nil {
		msg := cause.Error()
		reason = &msg
	}
	return s.repo.Meme.SetStatus(ctx, payload.AssetID, status, reason)
}

func (s *IngestService) analyze(ctx context.Context, asset *model.Asset, data []byte, caption string) error {
	prompt := s.cfg.CaptionPrompt
	if caption != "" {
		prompt = "" // Captioned offline
	}
	res, err := s.inferClient.AnalyzeImage(ctx, inference.ImageInput{
		Data:   data,
		Format: asset.Extension,
	}, prompt)
	if err != nil {
		return fmt.Errorf("failed to analyze image: %w", err)
	}
	if caption == "" {
		caption = res.Caption
	}

	vlmOut, err := inference.ParseVLMOutput(caption)
	if err != nil {
		return fmt.Errorf("failed to parse VLM output: %w", err)
	}

	metaphorEmb, semanticEmb, err := s.textEmbeddings(ctx, vlmOut)
	if err != nil {
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
			VLMJSON:          json.RawMessage(caption),
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

// textEmbeddings embeds the two texts searched by meaning: the metaphor, and the description with its tags.
func (s *IngestService) textEmbeddings(ctx context.Context, out *inference.VLMOutput) (metaphor, semantic []float32, err error) {
	g, gCtx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		if metaphor, err = s.inferClient.TextEmbedding(gCtx, out.GetMetaphorText(), s.cfg.RetrievalPrompt); err != nil {
			return fmt.Errorf("failed to get metaphor embedding: %w", err)
		}
		return nil
	})
	g.Go(func() (err error) {
		if semantic, err = s.inferClient.TextEmbedding(gCtx, out.GetSemanticText(), s.cfg.RetrievalPrompt); err != nil {
			return fmt.Errorf("failed to get semantic embedding: %w", err)
		}
		return nil
	})
	return metaphor, semantic, g.Wait()
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
