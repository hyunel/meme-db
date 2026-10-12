package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/pgvector/pgvector-go"
	"golang.org/x/sync/errgroup"
)

type MemeServiceConfig struct {
	RetrievalPrompt string
	TagMinUsage     int
	SearchPages     int
	SearchSessions  int
	SessionTTL      time.Duration
	RecallLimits    map[string]int // Hits per page of each search channel; a debug search may override them
	SimilarPages    int
	SimilarLimit    int // Hits per page of each similar memes channel
}

type MemeService struct {
	cfg         MemeServiceConfig
	repo        *repository.Provider
	assets      *AssetService
	inferClient inference.InferenceService
	notifier    Notifier
	sessions    *expirable.LRU[string, *searchSession]
}

func NewMemeService(
	cfg MemeServiceConfig,
	repo *repository.Provider,
	assets *AssetService,
	inferClient inference.InferenceService,
	notifier Notifier,
) *MemeService {
	return &MemeService{
		cfg:         cfg,
		repo:        repo,
		assets:      assets,
		inferClient: inferClient,
		notifier:    notifier,
		sessions:    expirable.NewLRU[string, *searchSession](cfg.SearchSessions, nil, cfg.SessionTTL),
	}
}

func (s *MemeService) Memes(ctx context.Context, viewer *rbac.Identity, ids []string) ([]*model.Meme, error) {
	return s.load(ctx, viewer, ids, viewer.IsAdmin())
}

// load lists the memes the viewer may see, or with all set every one of them, as a private link opens hidden ones.
func (s *MemeService) load(ctx context.Context, viewer *rbac.Identity, ids []string, all bool) ([]*model.Meme, error) {
	memes, err := s.repo.Meme.Memes(ctx, viewer.UserID, all, ids, s.cfg.TagMinUsage)
	if err != nil {
		return nil, err
	}
	s.assets.signMemes(memes)
	return orderByID(memes, ids, func(m *model.Meme) string { return m.ID }), nil
}

// Get finds a meme the viewer may see, or one a private link (share) opens.
func (s *MemeService) Get(ctx context.Context, viewer *rbac.Identity, id, share string) (*model.Meme, error) {
	memes, err := s.Memes(ctx, viewer, []string{id})
	if err != nil {
		return nil, err
	}
	if len(memes) == 0 && share != "" {
		opens, err := s.repo.Share.Opens(ctx, share, id)
		if err != nil {
			return nil, err
		}
		if opens {
			if memes, err = s.load(ctx, viewer, []string{id}, true); err != nil {
				return nil, err
			}
		}
	}
	if len(memes) == 0 {
		return nil, apperror.NotFound("表情包不存在或尚未公开")
	}
	return memes[0], nil
}

// Popular lists memes by popularity; the cursor is the popularity and id of the last meme before.
func (s *MemeService) Popular(ctx context.Context, viewer *rbac.Identity, tag, cursor string, limit int) (*model.Feed[*model.Meme], error) {
	var after *repository.Popularity
	if cursor != "" {
		score, id, _ := strings.Cut(cursor, "_")
		n, err := strconv.Atoi(score)
		if err != nil || uuid.Validate(id) != nil {
			return nil, apperror.BadRequest("游标无效")
		}
		after = &repository.Popularity{Score: n, AssetID: id}
	}
	rows, err := s.repo.Meme.Popular(ctx, viewer.UserID, viewer.IsAdmin(), tag, after, limit+1)
	if err != nil {
		return nil, err
	}
	rows, next := nextPage(rows, limit, func(p *repository.Popularity) string { return fmt.Sprintf("%d_%s", p.Score, p.AssetID) })
	ids := make([]string, len(rows))
	for i, p := range rows {
		ids[i] = p.AssetID
	}
	memes, err := s.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Feed[*model.Meme]{Items: memes, Next: next}, nil
}

// Count counts the analyzed memes of the whole site, public or not.
func (s *MemeService) Count(ctx context.Context) (int, error) {
	return s.repo.Meme.CountAnalyzed(ctx)
}

func (s *MemeService) Similar(ctx context.Context, viewer *rbac.Identity, id, share string, page int) (*model.Feed[*model.Meme], error) {
	if _, err := s.Get(ctx, viewer, id, share); err != nil {
		return nil, err
	}
	feed := &model.Feed[*model.Meme]{Items: []*model.Meme{}}
	if page >= s.cfg.SimilarPages {
		return feed, nil
	}
	metaphor, semantic, clip, err := s.repo.Meme.Vectors(ctx, id)
	if err != nil {
		return nil, err
	}

	var recalls []repository.Recall
	for _, v := range []struct {
		name string
		vec  *pgvector.Vector
	}{{"metaphor_vector", metaphor}, {"semantic_vector", semantic}, {"clip_vector", clip}} {
		if v.vec != nil {
			recalls = append(recalls, repository.Recall{Type: v.name, Column: v.name, Value: *v.vec, Limit: s.cfg.SimilarLimit})
		}
	}
	// A page deeper than asked, to tell whether another page follows.
	hits, err := s.repo.Meme.Recall(ctx, recalls, repository.RecallScope{ViewerID: viewer.UserID, Admin: viewer.IsAdmin(), Exclude: id}, page+2)
	if err != nil {
		return nil, fmt.Errorf("failed to perform similarity search: %w", err)
	}
	pages := paginate(hits, recalls)
	if page >= len(pages) {
		return feed, nil
	}

	candidates := pages[page]
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Similarity > candidates[j].Similarity })
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.AssetID
	}
	if feed.Items, err = s.Memes(ctx, viewer, ids); err != nil {
		return nil, err
	}
	if page+1 < min(len(pages), s.cfg.SimilarPages) {
		next := strconv.Itoa(page + 1)
		feed.Next = &next
	}
	return feed, nil
}

type SearchParams struct {
	Viewer   *rbac.Identity
	Query    string
	Image    *inference.ImageInput
	Mine     bool   // Search only the viewer's library instead of every meme they may see
	FolderID string // With Mine, restricts the search to a folder subtree
	Page     int    // The page to return, which resumes a search kept no more
}

// searchSession is a search recalled every page deep, kept for its pages to be reranked as they are fetched.
type searchSession struct {
	viewerID string
	query    string
	pages    [][]*model.SearchCandidate
}

// Search runs a search and returns a page of it; the cursors of the pages after it work while the search is kept.
func (s *MemeService) Search(ctx context.Context, params SearchParams) (*model.Feed[model.SearchResult], error) {
	scope := repository.RecallScope{ViewerID: params.Viewer.UserID, Admin: params.Viewer.IsAdmin(), Mine: params.Mine}
	if params.Mine && params.Viewer.UserID == "" {
		return nil, apperror.Unauthorized("登录后才能搜索我的库")
	}
	if params.Mine && params.FolderID != "" {
		folder, err := s.repo.Node.Get(ctx, params.FolderID)
		if err != nil {
			return nil, err
		}
		if folder == nil || folder.OwnerID != params.Viewer.UserID || folder.Type != model.NodeTypeFolder {
			return nil, apperror.NotFound("文件夹不存在")
		}
		scope.FolderPath = &folder.Path
	}

	run, err := s.search(ctx, params.Query, params.Image, scope, s.cfg.RecallLimits, s.cfg.SearchPages)
	if err != nil {
		return nil, err
	}
	id := rand.Text()
	session := &searchSession{viewerID: params.Viewer.UserID, query: params.Query, pages: run.pages}
	s.sessions.Add(id, session)
	return s.searchPage(ctx, params.Viewer, id, session, params.Page)
}

// SearchPage returns a page of a kept search by its cursor.
func (s *MemeService) SearchPage(ctx context.Context, viewer *rbac.Identity, cursor string) (*model.Feed[model.SearchResult], error) {
	id, p, _ := strings.Cut(cursor, "-")
	page, err := strconv.Atoi(p)
	session, ok := s.sessions.Get(id)
	if err != nil || !ok || session.viewerID != viewer.UserID {
		return nil, apperror.NotFound("搜索已过期，请重新搜索")
	}
	return s.searchPage(ctx, viewer, id, session, page)
}

func (s *MemeService) searchPage(ctx context.Context, viewer *rbac.Identity, id string, session *searchSession, page int) (*model.Feed[model.SearchResult], error) {
	feed := &model.Feed[model.SearchResult]{Items: []model.SearchResult{}}
	if page < 0 || page >= len(session.pages) {
		return feed, nil
	}

	candidates := session.pages[page]
	scores, err := s.rerank(ctx, session.query, candidates)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.AssetID
	}
	memes, err := s.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	memeByID := make(map[string]*model.Meme, len(memes))
	for _, m := range memes {
		memeByID[m.ID] = m
	}

	for i, c := range candidates {
		if meme, ok := memeByID[c.AssetID]; ok {
			feed.Items = append(feed.Items, model.SearchResult{Meme: meme, RecallType: c.RecallType, Score: scores[i], Similarity: c.Similarity})
		}
	}
	sort.Slice(feed.Items, func(i, j int) bool { return feed.Items[i].Score > feed.Items[j].Score })
	if page+1 < len(session.pages) {
		next := fmt.Sprintf("%s-%d", id, page+1)
		feed.Next = &next
	}
	return feed, nil
}

type searchRun struct {
	recalls []repository.Recall
	hits    []*model.SearchCandidate   // Of every channel
	pages   [][]*model.SearchCandidate // Each meme once, with its most similar hit
	timings SearchTimings
}

// search recalls pages deep by text (metaphor, semantic, CLIP and OCR) or by image (CLIP).
func (s *MemeService) search(ctx context.Context, query string, image *inference.ImageInput, scope repository.RecallScope, limits map[string]int, pages int) (*searchRun, error) {
	start := time.Now()
	var textVec, clipTextVec, clipImageVec []float32
	g, gCtx := errgroup.WithContext(ctx)
	if image != nil {
		g.Go(func() (err error) {
			clipImageVec, err = s.inferClient.ClipImageEmbedding(gCtx, *image)
			return err
		})
	} else if query != "" {
		g.Go(func() (err error) {
			textVec, err = s.inferClient.TextEmbedding(gCtx, query, s.cfg.RetrievalPrompt)
			return err
		})
		g.Go(func() (err error) {
			clipTextVec, err = s.inferClient.ClipTextEmbedding(gCtx, query)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to get embeddings: %w", err)
	}

	run := &searchRun{}
	run.timings.Embed = time.Since(start).Milliseconds()

	if image != nil {
		run.recalls = []repository.Recall{{Type: "clip_image", Column: "clip_vector", Value: pgvector.NewVector(clipImageVec), Limit: limits["clip_image"]}}
	} else if query != "" {
		run.recalls = []repository.Recall{
			{Type: "metaphor", Column: "metaphor_vector", Value: pgvector.NewVector(textVec), Limit: limits["metaphor"]},
			{Type: "semantic", Column: "semantic_vector", Value: pgvector.NewVector(textVec), Limit: limits["semantic"]},
			{Type: "clip_text", Column: "clip_vector", Value: pgvector.NewVector(clipTextVec), Limit: limits["clip_text"]},
			{Type: "ocr", Column: "ocr_text", Value: query, Limit: limits["ocr"]},
		}
	}

	step := time.Now()
	hits, err := s.repo.Meme.Recall(ctx, run.recalls, scope, pages)
	if err != nil {
		return nil, fmt.Errorf("failed to perform database search: %w", err)
	}
	run.hits, run.pages = hits, paginate(hits, run.recalls)
	run.timings.Recall = time.Since(step).Milliseconds()

	return run, nil
}

// paginate lays memes out on pages: page p takes each channel's hits ranked within (p·Limit, (p+1)·Limit], and a
// meme found more than once goes on the page of its shallowest hit, keeping its most similar one.
func paginate(hits []*model.SearchCandidate, recalls []repository.Recall) [][]*model.SearchCandidate {
	perPage := make(map[string]int, len(recalls))
	for _, rc := range recalls {
		perPage[rc.Type] = rc.Limit
	}
	type placed struct {
		hit  *model.SearchCandidate
		page int
	}
	byMeme := make(map[string]*placed, len(hits))
	var order []*placed
	for _, h := range hits {
		page := (h.Rank - 1) / perPage[h.RecallType]
		p, ok := byMeme[h.AssetID]
		if !ok {
			p = &placed{hit: h, page: page}
			byMeme[h.AssetID] = p
			order = append(order, p)
		}
		p.page = min(p.page, page)
		if h.Similarity > p.hit.Similarity {
			p.hit = h
		}
	}

	var pages [][]*model.SearchCandidate
	for _, p := range order {
		for len(pages) <= p.page {
			pages = append(pages, nil)
		}
		pages[p.page] = append(pages[p.page], p.hit)
	}
	return pages
}

// rerank scores the candidates against the query, or by their similarity without one.
func (s *MemeService) rerank(ctx context.Context, query string, candidates []*model.SearchCandidate) ([]float32, error) {
	scores := make([]float32, len(candidates))
	if query == "" {
		for i, c := range candidates {
			scores[i] = c.Similarity
		}
		return scores, nil
	}

	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.AssetID
	}
	captions, err := s.repo.Meme.Captions(ctx, ids)
	if err != nil {
		return nil, err
	}
	g, gCtx := errgroup.WithContext(ctx)
	for i, c := range candidates {
		out, err := inference.ParseVLMOutput(string(captions[c.AssetID]))
		if err != nil {
			slog.Warn("Failed to parse VLM output for rerank doc", "asset_id", c.AssetID, "error", err)
			scores[i] = -1 // Rank unparsable candidates last
			continue
		}
		g.Go(func() (err error) {
			scores[i], err = s.inferClient.Rerank(gCtx, query, out.GetRerankDoc(), s.cfg.RetrievalPrompt)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to rerank: %w", err)
	}
	return scores, nil
}

func (s *MemeService) Retry(ctx context.Context, viewer *rbac.Identity, id string) error {
	meme, err := s.Get(ctx, viewer, id, "")
	if err != nil {
		return err
	}
	if len(meme.Entries) == 0 && !viewer.IsAdmin() {
		return apperror.Forbidden("只能重试自己库中的表情包")
	}
	_, err = s.reanalyze(ctx, []string{id}, model.ProcessingStatusFailed)
	return err
}

func (s *MemeService) Reprocess(ctx context.Context, ids []string) (int, error) {
	return s.reanalyze(ctx, ids, model.ProcessingStatusSuccess, model.ProcessingStatusFailed)
}

func (s *MemeService) ReprocessMatching(ctx context.Context, f repository.MemeFilter) (int, error) {
	ids, _, err := s.repo.Meme.FilterIDs(ctx, f, nil)
	if err != nil {
		return 0, err
	}
	return s.Reprocess(ctx, ids)
}

func (s *MemeService) reanalyze(ctx context.Context, ids []string, from ...string) (int, error) {
	var reset []string
	err := s.repo.Tx(ctx, func(r *repository.Repos) (err error) {
		if reset, err = r.Meme.ResetForAnalysis(ctx, ids, from); err != nil {
			return err
		}
		return enqueueAnalysis(ctx, r, model.PriorityNormal, reset...)
	})
	if err != nil {
		return 0, err
	}
	if len(reset) > 0 {
		s.notifier.Notify()
	}
	return len(reset), nil
}

func (s *MemeService) List(ctx context.Context, viewer *rbac.Identity, f repository.MemeFilter, page repository.Page) (*model.Page[*model.Meme], error) {
	ids, total, err := s.repo.Meme.FilterIDs(ctx, f, &page)
	if err != nil {
		return nil, err
	}
	memes, err := s.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Page[*model.Meme]{Items: memes, Total: total}, nil
}

func (s *MemeService) Delete(ctx context.Context, ids []string) (int, error) {
	paths, err := s.repo.Asset.Delete(ctx, ids)
	if err != nil {
		return 0, err
	}
	s.assets.RemoveFiles(paths)
	return len(paths), nil
}
