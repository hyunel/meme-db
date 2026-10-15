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

const relatedCollections = 8 // Listed above the memes found in the whole site

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
		return nil, apperror.NotFound("meme_not_found", "meme not found or not public")
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
			return nil, apperror.BadRequest("invalid_cursor", "invalid cursor")
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
	FolderID string // Restricts the search to a folder subtree the viewer may open, if need be by the private link Share
	Share    string
	Page     int // The page to return, which resumes a search kept no more
}

// searchSession is a search recalled every page deep, kept for its pages to be reranked as they are fetched.
type searchSession struct {
	viewerID string
	query    string
	pages    [][]*model.SearchCandidate
	viaLink  bool // Searched a folder a private link opens, whose memes the viewer may see though hidden
}

// SearchFeed is a page of a search; the first of a search of the whole site comes with the public collections it found.
type SearchFeed struct {
	*model.Feed[model.SearchResult]
	Collections []*model.Folder `json:"collections,omitempty"`
}

// Search runs a search and returns a page of it; the cursors of the pages after it work while the search is kept.
func (s *MemeService) Search(ctx context.Context, params SearchParams) (*SearchFeed, error) {
	scope := repository.RecallScope{ViewerID: params.Viewer.UserID, Admin: params.Viewer.IsAdmin()}
	var viaLink bool
	switch {
	case params.FolderID != "":
		folder, err := publicFolder(ctx, s.repo, params.Viewer, params.FolderID, params.Share)
		if err != nil {
			return nil, err
		}
		scope.FolderPath, viaLink = &folder.Path, folder.ViaLink
	case params.Mine && params.Viewer.UserID == "":
		return nil, apperror.Unauthorized("library_search_unauthenticated", "sign in to search your library")
	default:
		scope.Mine = params.Mine
	}

	run, err := s.search(ctx, params.Query, params.Image, scope, s.cfg.RecallLimits, s.cfg.SearchPages)
	if err != nil {
		return nil, err
	}
	id := rand.Text()
	session := &searchSession{viewerID: params.Viewer.UserID, query: params.Query, pages: run.pages, viaLink: viaLink}
	s.sessions.Add(id, session)
	feed, err := s.searchPage(ctx, params.Viewer, id, session, params.Page)
	if err != nil {
		return nil, err
	}
	result := &SearchFeed{Feed: feed}
	if params.Page == 0 && !scope.Mine && scope.FolderPath == nil {
		result.Collections, err = s.collections(ctx, params.Viewer, run.hits)
	}
	return result, err
}

// collections lists the public collections holding the best of the hits, each shown by its memes among them.
func (s *MemeService) collections(ctx context.Context, viewer *rbac.Identity, hits []*model.SearchCandidate) ([]*model.Folder, error) {
	assetIDs := make([]string, len(hits))
	ranks := make([]int, len(hits))
	for i, h := range hits {
		assetIDs[i], ranks[i] = h.AssetID, h.Rank
	}
	found, err := s.repo.Node.Collections(ctx, assetIDs, ranks, relatedCollections)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(found))
	previews := make(map[string][]model.MemeThumb, len(found))
	for i, c := range found {
		ids[i], previews[c.ID] = c.ID, c.Previews
	}
	folders, err := s.repo.Node.Folders(ctx, viewer.UserID, ids)
	if err != nil {
		return nil, err
	}
	for _, f := range folders {
		f.Previews = previews[f.ID]
	}
	s.assets.signFolders(folders)
	return orderByID(folders, ids, func(f *model.Folder) string { return f.ID }), nil
}

// SearchPage returns a page of a kept search by its cursor.
func (s *MemeService) SearchPage(ctx context.Context, viewer *rbac.Identity, cursor string) (*model.Feed[model.SearchResult], error) {
	id, p, _ := strings.Cut(cursor, "-")
	page, err := strconv.Atoi(p)
	session, ok := s.sessions.Get(id)
	if err != nil || !ok || session.viewerID != viewer.UserID {
		return nil, apperror.NotFound("search_expired", "the search expired; search again")
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
	memes, err := s.load(ctx, viewer, ids, viewer.IsAdmin() || session.viaLink)
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
		return apperror.Forbidden("retry_not_in_library", "you can only retry memes in your library")
	}
	_, err = s.queue(ctx, model.JobAnalyzeMeme, []string{id}, repository.TaskOpts{Priority: model.PriorityNormal}, model.ProcessingStatusFailed)
	return err
}

// Rebuild runs a job over memes as one batch. Analysis sets them pending again; the embedding rebuilds leave them
// searchable, and skip the memes not analyzed.
func (s *MemeService) Rebuild(ctx context.Context, job string, ids []string) (int, string, error) {
	batch := uuid.Must(uuid.NewV7()).String()
	opts := repository.TaskOpts{Priority: model.PriorityLow, BatchID: &batch} // Behind new uploads
	if job == model.JobAnalyzeMeme {
		opts.Priority = model.PriorityNormal
	}
	n, err := s.queue(ctx, job, ids, opts, model.ProcessingStatusSuccess, model.ProcessingStatusFailed)
	return n, batch, err
}

func (s *MemeService) RebuildMatching(ctx context.Context, job string, f repository.MemeFilter) (int, string, error) {
	ids, _, err := s.repo.Meme.FilterIDs(ctx, f, nil)
	if err != nil {
		return 0, "", err
	}
	return s.Rebuild(ctx, job, ids)
}

// queue enqueues the job for the memes it applies to: an analysis for those in one of the from statuses, which it
// sets pending, and a rebuild for those analyzed.
func (s *MemeService) queue(ctx context.Context, job string, ids []string, opts repository.TaskOpts, from ...string) (int, error) {
	var queued []string
	err := s.repo.Tx(ctx, func(r *repository.Repos) (err error) {
		if job == model.JobAnalyzeMeme {
			queued, err = r.Meme.ResetForAnalysis(ctx, ids, from)
		} else {
			queued, err = r.Meme.Analyzed(ctx, ids)
		}
		if err != nil {
			return err
		}
		return enqueueMemeTasks(ctx, r, job, opts, queued...)
	})
	if err != nil {
		return 0, err
	}
	if len(queued) > 0 {
		s.notifier.Notify()
	}
	return len(queued), nil
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
