package inference

import (
	"context"
	"time"
)

type InferenceService interface {
	TextEmbedding(ctx context.Context, text string, task string) ([]float32, error)
	ClipImageEmbedding(ctx context.Context, image ImageInput) ([]float32, error)
	ClipTextEmbedding(ctx context.Context, text string) ([]float32, error)
	Rerank(ctx context.Context, query string, document string, task string) (float32, error)
	AnalyzeImage(ctx context.Context, image ImageInput, captionPrompt string) (*ImageAnalysis, error)
	Metrics(ctx context.Context, span, step time.Duration) ([]byte, error)
}
