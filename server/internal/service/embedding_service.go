package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/repository"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The inference service's roles whose embeddings the server stores
var embeddedRoles = []string{"clip", "text_embedding"}

// EmbeddingService keeps the stored embeddings from the inference service's models.
type EmbeddingService struct {
	repo        *repository.Provider
	inferClient inference.InferenceService
}

func NewEmbeddingService(repo *repository.Provider, inferClient inference.InferenceService) *EmbeddingService {
	return &EmbeddingService{repo: repo, inferClient: inferClient}
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
	changed := snapshot.Models[:0]
	for _, m := range snapshot.Models {
		if slices.Contains(embeddedRoles, m.Role) && stored[m.Role] != m.Name {
			changed = append(changed, m)
		}
	}
	if len(changed) == 0 {
		return nil
	}
	// Their embeddings are emptied, sized for the new models, and made anew meme by meme
	err = s.repo.Tx(ctx, func(r *repository.Repos) error {
		for _, m := range changed {
			if err := r.Embedding.Reset(ctx, m.Role, m.Dims); err != nil {
				return fmt.Errorf("%s: %w", m.Role, err)
			}
			if err := r.Embedding.SetModel(ctx, m.Role, m.Name); err != nil {
				return err
			}
		}
		ids, _, err := r.Meme.FilterIDs(ctx, repository.MemeFilter{}, nil)
		if err != nil {
			return err
		}
		_, _, err = rebuild(ctx, r, model.JobEmbedMeme, ids)
		return err
	})
	if err != nil {
		return err
	}
	for _, m := range changed {
		slog.Info("Adopted an embedding model", "role", m.Role, "from", stored[m.Role], "to", m.Name)
	}
	return nil
}
