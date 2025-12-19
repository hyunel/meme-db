package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
)

type VLMClient struct {
	client    *http.Client
	baseURL   string
	apiKey    string
	modelName string
}

func NewVLMClient(cfg *config.VLMConfig) *VLMClient {
	return &VLMClient{
		client:    &http.Client{Timeout: 60 * time.Second},
		baseURL:   cfg.BaseURL,
		apiKey:    cfg.APIKey,
		modelName: cfg.Model,
	}
}

const PromptVLM = `
# Role
You are an expert in Internet culture, semiotics, and visual analysis. Your task is to extract structured, high-density feature representations from the provided Meme image for a search engine.

# Constraints
1. NO Yapping: Do not use filler sentences like "The image depicts..." or "It seems to be...". Output raw, descriptive keywords and concise phrases.
2. Deep Reasoning: Analyze the interplay between the visual elements and the text to decode the *implied* meaning (sarcasm, irony, metaphor).
3. Format: Output STRICT JSON format only.

# Extraction Tasks (Think Step-by-Step)
Analyze the image in the following dimensions:

1.  OCR_Text: Transcribe all visible text verbatim.
2.  Visual_Subject: Describe the main visible elements using concise keywords or short phrases.
    - Examples: "Sweating Man", "Confused Cat", "Dinner Table", "Golden Hair", "Blue Eyes".
3.  Specific_Entities: Identify specific proper names, including celebrities, fictional characters, anime figures, famous IP sources, and source works.
    - Examples: "Hatsune Miku", "Elon Musk", "SpongeBob".
    - Constraint: **High Confidence Only**. If the character is generic, ambiguous, or you are not 100% sure of the identity, leave this array empty to avoid hallucinations.
4.  Visual_Style: Describe the aesthetic style using concise professional tags.
    - Examples: "3D Render", "Pixel Art", "Wojak", "Realistic", "Screenshot", "Anime", "Chibi".
    - Constraint: **DO NOT** describe image quality.
5.  Implied_Meaning: What specific vibe, attitude, or social reaction does sending this image convey?
    - Examples: "Smug superiority", "Pretending everything is fine", "Chaotic panic", "Reluctant acceptance", "Sarcastic surprise", "Sexual innuendo".
6.  Synthetic_Queries: Generate 3-5 distinct search queries a user would likely type.
    - Examples: "my face when boss calls", "shut up and take money", "awkward silence reaction", "math lady confused".
    - Constraint: Generate the **raw usage scenario**, **conversational intent**, or **internal monologue** directly, without meta descriptors (e.g., "XXX meme", "image for XXX").

# Output Schema (JSON)
{
  "ocr_text": "String" or null,
  "visual_subject": ["Keyword1", "Keyword2", ...],
  "specific_entities": ["Entity1", "Entity2", ...] or [],
  "visual_style": ["Tag1", "Tag2", ...],
  "implied_meaning": ["Keyword1", "Keyword2", ...],
  "synthetic_queries": ["Query1", "Query2", ...]
}
`

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []chatMessage   `json:"messages"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
	Temperature    float32         `json:"temperature,omitempty"`
}

type chatMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type imageContent struct {
	Type     string   `json:"type"`
	ImageURL imageURL `json:"image_url"`
}

type imageURL struct {
	URL string `json:"url"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c *VLMClient) Annotate(ctx context.Context, imageBytes []byte) (map[string]interface{}, error) {
	// Encode image to base64
	imgB64 := base64.StdEncoding.EncodeToString(imageBytes)

	// Create request payload
	reqBody := chatRequest{
		Model: c.modelName,
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: PromptVLM,
			},
			{
				Role: "user",
				Content: []interface{}{
					imageContent{
						Type: "image_url",
						ImageURL: imageURL{
							URL: fmt.Sprintf("data:image/jpeg;base64,%s", imgB64),
						},
					},
				},
			},
		},
		ResponseFormat: &responseFormat{Type: "json_object"},
		MaxTokens:      4096,
		Temperature:    0.0,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("api returned status: %d", resp.StatusCode)
	}

	var chatResp chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("no choices returned")
	}

	var result map[string]interface{}
	content := chatResp.Choices[0].Message.Content
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse content as json: %w", err)
	}

	return result, nil
}
