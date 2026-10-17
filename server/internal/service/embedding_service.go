package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The job embedding a meme anew, by the inference service's role whose embeddings it stores
var embeddingJobs = map[string]string{"clip": model.JobEmbedClip, "text_embedding": model.JobEmbedText}

// EmbeddingService keeps the stored embeddings from the inference service's models.
type EmbeddingService struct {
	tagPrompt   string
	repo        *repository.Provider
	memes       *MemeService
	inferClient inference.InferenceService
}

func NewEmbeddingService(tagPrompt string, repo *repository.Provider, memes *MemeService, inferClient inference.InferenceService) *EmbeddingService {
	return &EmbeddingService{tagPrompt: tagPrompt, repo: repo, memes: memes, inferClient: inferClient}
}

// Run adopts the inference service's embedding models, checking every minute, as the service may restart with others.
func (s *EmbeddingService) Run(ctx context.Context) {
	for {
		if err := s.adopt(ctx); err != nil && ctx.Err() == nil {
			slog.Error("Failed to adopt the embedding models", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Minute):
		}
	}
}

func (s *EmbeddingService) adopt(ctx context.Context) error {
	data, err := s.inferClient.Metrics(ctx, time.Minute, time.Minute)
	if status.Code(err) == codes.Unavailable {
		return nil // Down; checked again later
	}
	if err != nil {
		return err
	}
	var snapshot struct {
		Models []struct {
			Role string `json:"role"`
			Name string `json:"name"`
			Dims int    `json:"dims"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return err
	}
	stored, err := s.repo.Embedding.Models(ctx)
	if err != nil {
		return err
	}
	for _, m := range snapshot.Models {
		if job, ok := embeddingJobs[m.Role]; ok && stored[m.Role] != m.Name {
			if err := s.embedAnew(ctx, m.Role, m.Name, m.Dims, job); err != nil {
				return fmt.Errorf("%s: %w", m.Role, err)
			}
			slog.Info("Adopted an embedding model", "role", m.Role, "from", stored[m.Role], "to", m.Name)
		}
	}
	return nil
}

// embedAnew empties a role's embeddings, sized for its new model, and embeds them anew, the memes' in the background.
// The model is recorded last, so a step that fails is retried with the rest.
func (s *EmbeddingService) embedAnew(ctx context.Context, role, name string, dims int, job string) error {
	if err := s.reset(ctx, role, dims); err != nil {
		return err
	}
	if _, _, err := s.memes.RebuildMatching(ctx, job, repository.MemeFilter{}); err != nil {
		return err
	}
	return s.repo.Embedding.SetModel(ctx, role, name)
}

// reset empties a role's embeddings, giving the tags theirs at once, as new tags are matched against them and those
// of users have none. The tags are embedded before being locked, which then holds off changes only while those started
// or renamed since are.
func (s *EmbeddingService) reset(ctx context.Context, role string, dims int) error {
	if role != "text_embedding" {
		return s.repo.Tx(ctx, func(r *repository.Repos) error { return r.Embedding.Reset(ctx, role, dims) })
	}
	names, err := s.repo.Tag.Embedded(ctx)
	if err != nil {
		return err
	}
	vectors, err := s.embedTags(ctx, names, nil)
	if err != nil {
		return err
	}
	made := make(map[string]pgvector.Vector, len(names))
	for i, n := range names {
		made[n] = vectors[i]
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		if err := r.Tag.Lock(ctx); err != nil {
			return err
		}
		names, err := r.Tag.Embedded(ctx)
		if err != nil {
			return err
		}
		vectors, err := s.embedTags(ctx, names, made)
		if err != nil {
			return err
		}
		if err := r.Embedding.Reset(ctx, role, dims); err != nil {
			return err
		}
		return r.Tag.SetEmbeddings(ctx, names, vectors)
	})
}

// embedTags embeds the tag names, but for those already made.
func (s *EmbeddingService) embedTags(ctx context.Context, names []string, made map[string]pgvector.Vector) ([]pgvector.Vector, error) {
	vectors := make([]pgvector.Vector, len(names))
	g, gCtx := errgroup.WithContext(ctx)
	g.SetLimit(32)
	for i, tag := range names {
		if v, ok := made[tag]; ok {
			vectors[i] = v
			continue
		}
		g.Go(func() error {
			emb, err := s.inferClient.TextEmbedding(gCtx, tag, s.tagPrompt)
			vectors[i] = pgvector.NewVector(emb)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to embed tags: %w", err)
	}
	return vectors, nil
}
