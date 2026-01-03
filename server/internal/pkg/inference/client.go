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

func (c *Client) TextEmbedding(ctx context.Context, text string, task string) ([]float32, error) {
	resp, err := c.client.TextEmbedding(ctx, &pb.TextEmbeddingRequest{
		Text:            text,
		TaskDescription: task,
	})
	if err != nil {
		return nil, err
	}

	return resp.Embedding.Values, nil
}

func (c *Client) ClipImageEmbedding(ctx context.Context, image ImageInput) ([]float32, error) {
	resp, err := c.client.ClipImageEmbedding(ctx, &pb.ClipImageEmbeddingRequest{
		Image: &pb.Image{
			Data:       image.Data,
			FileFormat: image.Format,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.Embedding.Values, nil
}

func (c *Client) ClipTextEmbedding(ctx context.Context, text string) ([]float32, error) {
	resp, err := c.client.ClipTextEmbedding(ctx, &pb.ClipTextEmbeddingRequest{
		Text: text,
	})
	if err != nil {
		return nil, err
	}

	return resp.Embedding.Values, nil
}

func (c *Client) Rerank(ctx context.Context, query string, document string, task string) (float32, error) {
	resp, err := c.client.Rerank(ctx, &pb.RerankRequest{
		Query:           query,
		Document:        document,
		TaskDescription: task,
	})
	if err != nil {
		return 0, err
	}

	return resp.Score, nil
}

func (c *Client) ImageCaption(ctx context.Context, prompt string, image ImageInput) (*ImageCaptionResult, error) {
	resp, err := c.client.ImageCaption(ctx, &pb.ImageCaptionRequest{
		Prompt: prompt,
		Image: &pb.Image{
			Data:       image.Data,
			FileFormat: image.Format,
		},
	})
	if err != nil {
		return nil, err
	}

	var clipEmbedding []float32
	if resp.ClipEmbedding != nil {
		clipEmbedding = resp.ClipEmbedding.Values
	}

	return &ImageCaptionResult{
		Caption:       resp.Caption,
		Width:         int(resp.Width),
		Height:        int(resp.Height),
		ClipEmbedding: clipEmbedding,
	}, nil
}
