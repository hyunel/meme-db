package inference

import (
	"context"
)

type InferenceService interface {
	TextEmbedding(ctx context.Context, texts []string, task string) ([][]float32, error)
	ClipImageEmbedding(ctx context.Context, images []ImageInput) ([][]float32, error)
	ClipTextEmbedding(ctx context.Context, texts []string) ([][]float32, error)
	Rerank(ctx context.Context, query string, documents []string, task string) ([]float32, error)
	AnalyzeImage(ctx context.Context, inputs []AnalyzeInput) ([]*AnalyzeOutput, error)
}
