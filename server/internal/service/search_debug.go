package service

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"sort"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

type SearchTimings struct { // Milliseconds
	Embed  int64 `json:"embed"`
	Recall int64 `json:"recall"`
	Rerank int64 `json:"rerank"`
	Total  int64 `json:"total"`
}

type SearchDebugParams struct {
	Viewer *rbac.Identity
	Query  string
	Image  *inference.ImageInput
	Public bool           // Search as a guest, among public memes only
	Limits map[string]int // Recall limits overriding the defaults
	Track  string         // A meme whose placement to explain
}

type SearchDebug struct {
	Prompt     string                   `json:"prompt"`
	Timings    SearchTimings            `json:"timings"`
	Channels   []DebugChannel           `json:"channels"`
	Candidates []DebugCandidate         `json:"candidates"` // Best first
	Memes      []*model.Meme            `json:"memes"`
	Captions   map[string]*DebugCaption `json:"captions"`
	Tracked    *DebugTracked            `json:"tracked"`
}

type DebugChannel struct {
	Channel string     `json:"channel"`
	Limit   int        `json:"limit"`
	Hits    []DebugHit `json:"hits"` // Most similar first
}

type DebugHit struct {
	ID         string  `json:"id"`
	Similarity float32 `json:"similarity"`
}

type DebugCandidate struct {
	ID          string   `json:"id"`
	Score       float32  `json:"score"`
	RerankScore *float32 `json:"rerank_score"` // Nil without a text query; -1 when the caption cannot be parsed
	BestChannel string   `json:"best_channel"`
}

type DebugCaption struct {
	Raw          json.RawMessage      `json:"raw"`
	VLM          *inference.VLMOutput `json:"vlm"` // Nil when the raw caption cannot be parsed
	MetaphorText string               `json:"metaphor_text"`
	SemanticText string               `json:"semantic_text"`
	RerankDoc    string               `json:"rerank_doc"`
}

type DebugTracked struct {
	ID       string      `json:"id"`
	Excluded string      `json:"excluded,omitempty"` // Why it is not searched at all: missing | not_analyzed | private
	Channels []DebugRank `json:"channels"`
}

type DebugRank struct {
	Channel    string  `json:"channel"`
	Similarity float32 `json:"similarity"`
	Rank       *int    `json:"rank"` // Nil when the channel does not match the meme at all
}

// Debug runs a search like Search does and reports every step of it.
func (s *MemeService) Debug(ctx context.Context, p SearchDebugParams) (*SearchDebug, error) {
	scope := repository.RecallScope{ViewerID: p.Viewer.UserID, Admin: p.Viewer.IsAdmin()}
	if p.Public {
		scope = repository.RecallScope{}
	}

	limits := maps.Clone(recallLimits)
	maps.Copy(limits, p.Limits)
	run, err := s.search(ctx, p.Query, p.Image, scope, limits)
	if err != nil {
		return nil, err
	}

	out := &SearchDebug{Prompt: s.cfg.RetrievalPrompt, Timings: run.timings, Channels: []DebugChannel{}, Candidates: []DebugCandidate{}, Captions: map[string]*DebugCaption{}}

	for _, rc := range run.recalls {
		ch := DebugChannel{Channel: rc.Type, Limit: rc.Limit, Hits: []DebugHit{}}
		for _, h := range run.hits {
			if h.RecallType == rc.Type {
				ch.Hits = append(ch.Hits, DebugHit{ID: h.AssetID, Similarity: h.Similarity})
			}
		}
		sort.Slice(ch.Hits, func(i, j int) bool { return ch.Hits[i].Similarity > ch.Hits[j].Similarity })
		out.Channels = append(out.Channels, ch)
	}

	ids := make([]string, 0, len(run.candidates)+1)
	for i, c := range run.candidates {
		dc := DebugCandidate{ID: c.AssetID, Score: run.scores[i], BestChannel: c.RecallType}
		if p.Query != "" {
			dc.RerankScore = &run.scores[i]
		}
		out.Candidates = append(out.Candidates, dc)
		ids = append(ids, c.AssetID)
	}
	sort.SliceStable(out.Candidates, func(i, j int) bool { return out.Candidates[i].Score > out.Candidates[j].Score })

	if p.Track != "" {
		if out.Tracked, err = s.track(ctx, p, scope, run.recalls); err != nil {
			return nil, err
		}
		if !slices.Contains(ids, p.Track) {
			ids = append(ids, p.Track)
		}
	}

	if out.Memes, err = s.Memes(ctx, p.Viewer, ids); err != nil {
		return nil, err
	}

	raw, err := s.repo.Meme.Captions(ctx, ids)
	if err != nil {
		return nil, err
	}
	for id, r := range raw {
		c := &DebugCaption{Raw: r}
		if vlm, err := inference.ParseVLMOutput(string(r)); err == nil {
			c.VLM, c.MetaphorText, c.SemanticText, c.RerankDoc = vlm, vlm.GetMetaphorText(), vlm.GetSemanticText(), vlm.GetRerankDoc()
		}
		out.Captions[id] = c
	}

	return out, nil
}

// track reports how the tracked meme scores in each channel, or why it is not searched.
func (s *MemeService) track(ctx context.Context, p SearchDebugParams, scope repository.RecallScope, recalls []repository.Recall) (*DebugTracked, error) {
	t := &DebugTracked{ID: p.Track, Channels: []DebugRank{}}

	memes, err := s.Memes(ctx, p.Viewer, []string{p.Track})
	switch {
	case err != nil:
		return nil, err
	case len(memes) == 0:
		t.Excluded = "missing"
	case memes[0].AnalyzedAt == nil:
		t.Excluded = "not_analyzed"
	case p.Public && !memes[0].IsPublic:
		t.Excluded = "private"
	default:
		for _, rc := range recalls {
			similarity, rank, err := s.repo.Meme.RecallRank(ctx, rc, scope, p.Track)
			if err != nil {
				return nil, err
			}
			t.Channels = append(t.Channels, DebugRank{Channel: rc.Type, Similarity: similarity, Rank: rank})
		}
	}

	return t, nil
}
