package inference

import (
	"context"
	"fmt"

	pb "github.com/hyunel/MemeDB/internal/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Client struct {
	conn   *grpc.ClientConn
	client pb.InferenceServiceClient
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

func NewClient(addr string) (*Client, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to inference service: %w", err)
	}

	client := pb.NewInferenceServiceClient(conn)
	return &Client{conn: conn, client: client}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) TextEmbedding(ctx context.Context, texts []string, task string) ([][]float32, error) {
	resp, err := c.client.TextEmbedding(ctx, &pb.TextEmbeddingRequest{
		Texts:           texts,
		TaskDescription: task,
	})
	if err != nil {
		return nil, err
	}

	result := make([][]float32, len(resp.Embeddings))
	for i, emb := range resp.Embeddings {
		result[i] = emb.Values
	}
	return result, nil
}

func (c *Client) ClipImageEmbedding(ctx context.Context, images []ImageInput) ([][]float32, error) {
	pbImages := make([]*pb.Image, len(images))
	for i, img := range images {
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

	result := make([][]float32, len(resp.Embeddings))
	for i, emb := range resp.Embeddings {
		result[i] = emb.Values
	}
	return result, nil
}

func (c *Client) ClipTextEmbedding(ctx context.Context, texts []string) ([][]float32, error) {
	resp, err := c.client.ClipTextEmbedding(ctx, &pb.ClipTextEmbeddingRequest{
		Texts: texts,
	})
	if err != nil {
		return nil, err
	}

	result := make([][]float32, len(resp.Embeddings))
	for i, emb := range resp.Embeddings {
		result[i] = emb.Values
	}
	return result, nil
}

func (c *Client) Rerank(ctx context.Context, query string, documents []string, task string) ([]float32, error) {
	pairs := make([]*pb.RerankPair, len(documents))
	for i, doc := range documents {
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
}

func (c *Client) ImageCaption(ctx context.Context, prompt string, images []ImageInput) ([]*ImageCaptionResult, error) {
	pbImages := make([]*pb.Image, len(images))
	for i, img := range images {
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
}
