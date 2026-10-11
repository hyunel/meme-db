package inference

import (
	"context"
	"fmt"
	"time"

	pb "github.com/hyunel/MemeDB/internal/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	PriorityBackground  int32 = 0
	PriorityInteractive int32 = 10
)

type Client struct {
	conn     *grpc.ClientConn
	client   pb.InferenceServiceClient
	priority int32
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

func (c *Client) WithPriority(priority int32) *Client {
	clone := *c
	clone.priority = priority
	return &clone
}

func (c *Client) options() *pb.TaskOptions {
	return &pb.TaskOptions{Priority: c.priority}
}

func (c *Client) TextEmbedding(ctx context.Context, text string, task string) ([]float32, error) {
	resp, err := c.client.TextEmbedding(ctx, &pb.TextEmbeddingRequest{
		Options:         c.options(),
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
		Options: c.options(),
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
		Options: c.options(),
		Text:    text,
	})
	if err != nil {
		return nil, err
	}

	return resp.Embedding.Values, nil
}

func (c *Client) Rerank(ctx context.Context, query string, document string, task string) (float32, error) {
	resp, err := c.client.Rerank(ctx, &pb.RerankRequest{
		Options:         c.options(),
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
		Options: c.options(),
		Prompt:  prompt,
		Image: &pb.Image{
			Data:       image.Data,
			FileFormat: image.Format,
		},
	}, grpc.WaitForReady(true)) // Wait out an inference restart instead of burning ingestion retries
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

// Metrics returns the service's dashboard snapshot as JSON; unlike requests, it fails fast while the service is down.
func (c *Client) Metrics(ctx context.Context, span, step time.Duration) ([]byte, error) {
	resp, err := c.client.Metrics(ctx, &pb.MetricsRequest{SpanSeconds: int32(span.Seconds()), StepSeconds: int32(step.Seconds())})
	if err != nil {
		return nil, err
	}
	return resp.Json, nil
}
