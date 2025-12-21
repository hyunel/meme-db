package inference

import (
	"encoding/json"
	"strings"
)

type VLMOutput struct {
	OCRText          string
	VisualSubject    []string
	SpecificEntities []string
	VisualStyle      []string
	ImpliedMeaning   []string
	SyntheticQueries []string

	MetaphorText string
	SemanticText string
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
	out.OCRText, _ = raw["ocr_text"].(string)
	out.VisualSubject = toStringSlice(raw["visual_subject"])
	out.SpecificEntities = toStringSlice(raw["specific_entities"])
	out.VisualStyle = toStringSlice(raw["visual_style"])
	out.ImpliedMeaning = toStringSlice(raw["implied_meaning"])
	out.SyntheticQueries = toStringSlice(raw["synthetic_queries"])

	out.MetaphorText, _ = raw["metaphor_text"].(string)
	out.SemanticText, _ = raw["semantic_text"].(string)

	return out, nil
}

func (out *VLMOutput) GetMetaphorText() string {
	if out.MetaphorText != "" {
		return out.MetaphorText
	}
	metaphorArray := append([]string{}, out.SyntheticQueries...)
	metaphorArray = append(metaphorArray, out.ImpliedMeaning...)
	return strings.Join(metaphorArray, ", ")
}

func (out *VLMOutput) GetSemanticText() string {
	if out.SemanticText != "" {
		return out.SemanticText
	}
	semanticArray := append([]string{}, out.SpecificEntities...)
	semanticArray = append(semanticArray, out.VisualSubject...)
	semanticArray = append(semanticArray, out.VisualStyle...)
	return strings.Join(semanticArray, ", ")
}

func (out *VLMOutput) GetRerankDoc() string {
	parts := []string{}
	if out.OCRText != "" {
		parts = append(parts, out.OCRText)
	}
	metaphor := out.GetMetaphorText()
	if metaphor != "" {
		parts = append(parts, metaphor)
	}
	semantic := out.GetSemanticText()
	if semantic != "" {
		parts = append(parts, semantic)
	}
	return strings.Join(parts, ", ")
}
