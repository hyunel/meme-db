package inference

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/config"
	pb "github.com/hyunel/MemeDB/internal/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Client struct {
	conn   *grpc.ClientConn
	client pb.InferenceServiceClient
	cfg    config.BatchConfig
}

type ImageInput struct {
	Data   []byte
	Format string
}

type ImageCaptionResult struct {
	Caption       string
	Width         int
	Height        int
	ClipEmbedding []float32
}

func NewClient(addr string, cfg config.BatchConfig) (*Client, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to inference service: %w", err)
	}

	client := pb.NewInferenceServiceClient(conn)
	return &Client{conn: conn, client: client, cfg: cfg}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func processInBatches[T any, R any](
	ctx context.Context,
	items []T,
	batchSize int,
	processFunc func(ctx context.Context, batch []T) ([]R, error),
) ([]R, error) {
	if len(items) == 0 {
		return []R{}, nil
	}

	if batchSize <= 0 {
		batchSize = len(items)
	}

	allResults := make([]R, 0, len(items))
	for i := 0; i < len(items); i += batchSize {
		end := i + batchSize
		if end > len(items) {
			end = len(items)
		}

		results, err := processFunc(ctx, items[i:end])
		if err != nil {
			return nil, err
		}

		allResults = append(allResults, results...)
	}

	return allResults, nil
}

func (c *Client) TextEmbedding(ctx context.Context, texts []string, task string) ([][]float32, error) {
	return processInBatches(ctx, texts, c.cfg.TextEmbedding, func(ctx context.Context, batch []string) ([][]float32, error) {
		resp, err := c.client.TextEmbedding(ctx, &pb.TextEmbeddingRequest{
			Texts:           batch,
			TaskDescription: task,
		})
		if err != nil {
			return nil, err
		}

		results := make([][]float32, len(resp.Embeddings))
		for i, emb := range resp.Embeddings {
			results[i] = emb.Values
		}
		return results, nil
	})
}

func (c *Client) ClipImageEmbedding(ctx context.Context, images []ImageInput) ([][]float32, error) {
	return processInBatches(ctx, images, c.cfg.ClipEmbedding, func(ctx context.Context, batch []ImageInput) ([][]float32, error) {
		pbImages := make([]*pb.Image, len(batch))
		for i, img := range batch {
			pbImages[i] = &pb.Image{
				Data:       img.Data,
				FileFormat: img.Format,
			}
		}

		resp, err := c.client.ClipImageEmbedding(ctx, &pb.ClipImageEmbeddingRequest{
			Images: pbImages,
		})
		if err != nil {
			return nil, err
		}

		results := make([][]float32, len(resp.Embeddings))
		for i, emb := range resp.Embeddings {
			results[i] = emb.Values
		}
		return results, nil
	})
}

func (c *Client) ClipTextEmbedding(ctx context.Context, texts []string) ([][]float32, error) {
	return processInBatches(ctx, texts, c.cfg.ClipEmbedding, func(ctx context.Context, batch []string) ([][]float32, error) {
		resp, err := c.client.ClipTextEmbedding(ctx, &pb.ClipTextEmbeddingRequest{
			Texts: batch,
		})
		if err != nil {
			return nil, err
		}

		results := make([][]float32, len(resp.Embeddings))
		for i, emb := range resp.Embeddings {
			results[i] = emb.Values
		}
		return results, nil
	})
}

func (c *Client) Rerank(ctx context.Context, query string, documents []string, task string) ([]float32, error) {
	return processInBatches(ctx, documents, c.cfg.Rerank, func(ctx context.Context, batch []string) ([]float32, error) {
		pairs := make([]*pb.RerankPair, len(batch))
		for i, doc := range batch {
			pairs[i] = &pb.RerankPair{
				Query:    query,
				Document: doc,
			}
		}

		resp, err := c.client.Rerank(ctx, &pb.RerankRequest{
			Pairs:           pairs,
			TaskDescription: task,
		})
		if err != nil {
			return nil, err
		}

		return resp.Scores, nil
	})
}

func (c *Client) ImageCaption(ctx context.Context, prompt string, images []ImageInput) ([]*ImageCaptionResult, error) {
	return processInBatches(ctx, images, c.cfg.ImageCaption, func(ctx context.Context, batch []ImageInput) ([]*ImageCaptionResult, error) {
		pbImages := make([]*pb.Image, len(batch))
		for i, img := range batch {
			pbImages[i] = &pb.Image{
				Data:       img.Data,
				FileFormat: img.Format,
			}
		}

		resp, err := c.client.ImageCaption(ctx, &pb.ImageCaptionRequest{
			Prompt: prompt,
			Images: pbImages,
		})
		if err != nil {
			return nil, err
		}

		results := make([]*ImageCaptionResult, len(resp.Results))
		for i, res := range resp.Results {
			var clipEmbedding []float32
			if res.ClipEmbedding != nil {
				clipEmbedding = res.ClipEmbedding.Values
			}

			results[i] = &ImageCaptionResult{
				Caption:       res.Caption,
				Width:         int(res.Width),
				Height:        int(res.Height),
				ClipEmbedding: clipEmbedding,
			}
		}
		return results, nil
	})
}
