package inference

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
)

var ocrNoiseRegex = regexp.MustCompile(`(?i)(?:key\s+)?frame\s+\d+/\d+\n?`)

// VLMOutput is the caption: English fields for search, and title, summary and tags in the configured language for users.
type VLMOutput struct {
	OCRText     string   `json:"ocr_text"`
	Description string   `json:"description"`
	Meaning     string   `json:"meaning"`
	Queries     []string `json:"queries"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	Tags        []string `json:"tags"`
}

func toStringSlice(v any) []string {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case []string:
		return val
	case []any:
		var res []string
		for _, item := range val {
			if s, ok := item.(string); ok {
				res = append(res, s)
			}
		}
		return res
	case string:
		return []string{val}
	default:
		return nil
	}
}

func ParseVLMOutput(caption string) (*VLMOutput, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(caption), &raw); err != nil {
		return nil, err
	}

	out := &VLMOutput{}
	if ocr, ok := raw["ocr_text"].(string); ok {
		out.OCRText = strings.TrimSpace(ocrNoiseRegex.ReplaceAllString(ocr, "")) // Drop the key frame labels drawn on stitched frames
	}
	out.Description, _ = raw["description"].(string)
	out.Meaning, _ = raw["meaning"].(string)
	out.Queries = toStringSlice(raw["queries"])
	out.Title, _ = raw["title"].(string)
	out.Summary, _ = raw["summary"].(string)
	out.Tags = toStringSlice(raw["tags"])
	return out, nil
}

func (out *VLMOutput) GetMetaphorText() string {
	return strings.Join(append([]string{out.Meaning}, out.Queries...), "\n")
}

func (out *VLMOutput) GetSemanticText() string {
	return out.Description + "\n" + strings.Join(out.Tags, ", ")
}

func (out *VLMOutput) GetRerankDoc() string {
	parts := []string{out.Title, out.OCRText, out.Description, out.Meaning, strings.Join(out.Tags, ", "), strings.Join(out.Queries, "; ")}
	return strings.Join(slices.DeleteFunc(parts, func(p string) bool { return p == "" }), "\n")
}
