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

type AnalyzeInput struct {
	Image   ImageInput
	VlmJson string
}

type AnalyzeOutput struct {
	OcrText        string
	ClipVector     []float32
	MetaphorVector []float32
	SemanticVector []float32
	VlmJson        string
	Width          int
	Height         int
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

func (c *Client) AnalyzeImage(ctx context.Context, inputs []AnalyzeInput) ([]*AnalyzeOutput, error) {
	pbInputs := make([]*pb.AnalyzeImageInput, len(inputs))
	for i, input := range inputs {
		pbInputs[i] = &pb.AnalyzeImageInput{
			Image: &pb.Image{
				Data:       input.Image.Data,
				FileFormat: input.Image.Format,
			},
			VlmJson: input.VlmJson,
		}
	}

	resp, err := c.client.AnalyzeImage(ctx, &pb.AnalyzeImageRequest{
		Inputs: pbInputs,
	})
	if err != nil {
		return nil, err
	}

	outputs := make([]*AnalyzeOutput, len(resp.Results))
	for i, res := range resp.Results {
		outputs[i] = &AnalyzeOutput{
			OcrText:        res.OcrText,
			ClipVector:     res.ClipVector,
			MetaphorVector: res.MetaphorVector,
			SemanticVector: res.SemanticVector,
			VlmJson:        res.VlmJson,
			Width:          int(res.Width),
			Height:         int(res.Height),
		}
	}

	return outputs, nil
}
