package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
)

const (
	// A meme stays listed while it is re-analyzed, so "analyzed once" rather than the current status.
	memeAnalyzed = `m.analyzed_at IS NOT NULL`
	memeInPublic = `EXISTS (SELECT 1 FROM library.public_files pf WHERE pf.asset_id = m.asset_id)`
	memePublic   = `(` + memeAnalyzed + ` AND ` + memeInPublic + `)`
)

func memeOwnedBy(viewer string) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = m.asset_id AND n.owner_id = %s::uuid)`, viewer)
}

func memeListed(w *filter, viewerID string, admin bool) string {
	switch {
	case admin:
		return memeAnalyzed
	case viewerID == "":
		return memePublic
	}
	return "(" + memeAnalyzed + " AND (" + memeInPublic + " OR " + memeOwnedBy(w.arg(viewerID)) + "))"
}

type MemeRepository struct {
	db db.DBTX
}

func (r *MemeRepository) Create(ctx context.Context, meme *model.MemeInfo) error {
	query := `
		INSERT INTO core.meme_info (asset_id, vlm_json, ocr_text, metaphor_vector, semantic_vector, clip_vector, width, height, processing_status, analyzed_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (asset_id) DO UPDATE SET
			vlm_json = EXCLUDED.vlm_json, ocr_text = EXCLUDED.ocr_text,
			metaphor_vector = EXCLUDED.metaphor_vector, semantic_vector = EXCLUDED.semantic_vector, clip_vector = EXCLUDED.clip_vector,
			width = EXCLUDED.width, height = EXCLUDED.height,
			processing_status = EXCLUDED.processing_status, fail_reason = NULL, analyzed_at = EXCLUDED.analyzed_at
	`
	_, err := r.db.Exec(ctx, query,
		meme.AssetID, meme.VLMJSON, meme.OCRText,
		meme.MetaphorVector, meme.SemanticVector, meme.ClipVector,
		meme.Width, meme.Height, meme.ProcessingStatus, meme.AnalyzedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create/update meme info: %w", err)
	}
	return nil
}

func (r *MemeRepository) SetStatus(ctx context.Context, assetID, status string, failReason *string) error {
	query := `UPDATE core.meme_info SET processing_status = $2, fail_reason = $3 WHERE asset_id = $1::uuid`
	_, err := r.db.Exec(ctx, query, assetID, status, failReason)
	return err
}

func (r *MemeRepository) ResetForAnalysis(ctx context.Context, assetIDs []string, from []string) ([]string, error) {
	query := `
		UPDATE core.meme_info SET processing_status = 'pending', fail_reason = NULL
		WHERE asset_id = ANY($1::uuid[]) AND processing_status = ANY($2)
		RETURNING asset_id::text
	`
	return collectScalars[string](r.db.Query(ctx, query, assetIDs, from))
}

type memeRow struct {
	ID            string          `db:"id"`
	MimeType      string          `db:"mime_type"`
	FileSize      int64           `db:"file_size"`
	CreatedAt     time.Time       `db:"created_at"`
	Width         int             `db:"width"`
	Height        int             `db:"height"`
	Status        string          `db:"status"`
	FailReason    *string         `db:"fail_reason"`
	OCRText       string          `db:"ocr_text"`
	VLMJSON       []byte          `db:"vlm_json"`
	AnalyzedAt    *time.Time      `db:"analyzed_at"`
	IsPublic      bool            `db:"is_public"`
	FavoriteCount int             `db:"favorite_count"`
	LibraryCount  int             `db:"library_count"`
	IsFavorite    bool            `db:"is_favorite"`
	Entry         *model.EntryRef `db:"entry"`
	Tags          []model.MemeTag `db:"tags"`
}

func (row *memeRow) toModel() *model.Meme {
	var vlm struct {
		ImpliedMeaning []string `json:"implied_meaning"`
	}
	_ = json.Unmarshal(row.VLMJSON, &vlm) // Keywords are best effort; the VLM output is free-form
	if vlm.ImpliedMeaning == nil {
		vlm.ImpliedMeaning = []string{}
	}
	return &model.Meme{
		ID:            row.ID,
		MimeType:      row.MimeType,
		FileSize:      row.FileSize,
		Width:         row.Width,
		Height:        row.Height,
		Status:        row.Status,
		FailReason:    row.FailReason,
		OCRText:       row.OCRText,
		Keywords:      vlm.ImpliedMeaning,
		Tags:          row.Tags,
		IsPublic:      row.IsPublic,
		FavoriteCount: row.FavoriteCount,
		LibraryCount:  row.LibraryCount,
		IsFavorite:    row.IsFavorite,
		Entry:         row.Entry,
		CreatedAt:     row.CreatedAt,
		AnalyzedAt:    row.AnalyzedAt,
	}
}

func (r *MemeRepository) Memes(ctx context.Context, viewerID string, admin bool, ids []string) ([]*model.Meme, error) {
	if len(ids) == 0 {
		return []*model.Meme{}, nil
	}
	query := fmt.Sprintf(`
		SELECT a.id, a.mime_type, a.file_size, a.created_at,
			COALESCE(m.width, 0) AS width, COALESCE(m.height, 0) AS height,
			m.processing_status AS status, m.fail_reason, COALESCE(m.ocr_text, '') AS ocr_text,
			m.vlm_json, m.analyzed_at,
			%[1]s AS is_public,
			(SELECT count(*) FROM library.favorites f WHERE f.asset_id = a.id) AS favorite_count,
			(SELECT count(*) FROM library.nodes n WHERE n.asset_id = a.id) AS library_count,
			EXISTS (SELECT 1 FROM library.favorites f WHERE f.asset_id = a.id AND f.user_id = $2::uuid) AS is_favorite,
			(SELECT jsonb_build_object('id', n.id, 'folder_id', n.parent_id) FROM library.nodes n
			 WHERE n.asset_id = a.id AND n.owner_id = $2::uuid ORDER BY n.created_at LIMIT 1) AS entry,
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'mine', at.user_id IS NOT NULL)
					ORDER BY at.user_id NULLS FIRST, t.name)
				FROM library.asset_tags at JOIN library.tags t ON t.id = at.tag_id
				WHERE at.asset_id = a.id AND (at.user_id IS NULL OR at.user_id = $2::uuid)
			), '[]') AS tags
		FROM core.assets a
		JOIN core.meme_info m ON m.asset_id = a.id
		WHERE a.id = ANY($1::uuid[]) AND ($3 OR %[2]s OR %[3]s)
	`, memeInPublic, memePublic, memeOwnedBy("$2"))

	rows, err := collectAll[memeRow](r.db.Query(ctx, query, ids, nullable(viewerID), admin))
	if err != nil {
		return nil, err
	}
	memes := make([]*model.Meme, len(rows))
	for i, row := range rows {
		memes[i] = row.toModel()
	}
	return memes, nil
}

func (r *MemeRepository) PopularIDs(ctx context.Context, viewerID string, admin bool, tag string, limit int) ([]string, int, error) {
	var w filter
	w.where(memeListed(&w, viewerID, admin))
	if tag != "" {
		w.where(fmt.Sprintf(`EXISTS (
			SELECT 1 FROM library.asset_tags at JOIN library.tags t ON t.id = at.tag_id
			WHERE at.asset_id = m.asset_id AND t.name = %s AND (at.user_id IS NULL OR at.user_id = %s::uuid))`,
			w.arg(tag), w.arg(nullable(viewerID))))
	}
	query := fmt.Sprintf(`
		SELECT m.asset_id::text, count(*) OVER () FROM core.meme_info m %s
		ORDER BY (SELECT count(*) FROM library.favorites f WHERE f.asset_id = m.asset_id) * 3
			+ (SELECT count(*) FROM library.nodes n WHERE n.asset_id = m.asset_id) DESC, m.asset_id DESC
		LIMIT %d
	`, w.clause(), limit)
	return collectIDsWithTotal(r.db.Query(ctx, query, w.args...))
}

type MemeFilter struct {
	Query      string // Matches the meme ID
	Status     string
	Visibility string // public | private
	Kind       string // image | gif | video | lottie
	Created    TimeRange
}

var memeKinds = map[string]string{
	"gif":    `a.mime_type = 'image/gif'`,
	"image":  `a.mime_type LIKE 'image/%' AND a.mime_type <> 'image/gif'`,
	"video":  `a.mime_type LIKE 'video/%'`,
	"lottie": `a.mime_type IN ('application/json', 'application/x-gzip', 'application/gzip', 'application/zip')`,
}

func (r *MemeRepository) FilterIDs(ctx context.Context, f MemeFilter, page *Page) ([]string, int, error) {
	var w filter
	if f.Query != "" {
		w.where("a.id::text ILIKE " + w.arg("%"+f.Query+"%"))
	}
	if f.Status != "" {
		w.where("m.processing_status = " + w.arg(f.Status))
	}
	switch f.Visibility {
	case "public":
		w.where(memeInPublic)
	case "private":
		w.where("NOT " + memeInPublic)
	}
	if cond, ok := memeKinds[f.Kind]; ok {
		w.where(cond)
	}
	w.timeRange("a.created_at", f.Created)

	from := "FROM core.assets a JOIN core.meme_info m ON m.asset_id = a.id " + w.clause()
	if page == nil { // Every match, uncounted
		ids, err := collectScalars[string](r.db.Query(ctx, "SELECT a.id::text "+from, w.args...))
		return ids, len(ids), err
	}
	total, err := count(ctx, r.db, "SELECT count(*) "+from, w.args...)
	if err != nil {
		return nil, 0, err
	}
	query := fmt.Sprintf("SELECT a.id::text %s ORDER BY a.created_at DESC %s", from, page.clause())
	ids, err := collectScalars[string](r.db.Query(ctx, query, w.args...))
	return ids, total, err
}

type Recall struct {
	Type   string // Reported as recall_type
	Column string // Vector column of core.meme_info, or "ocr_text" for trigram matching
	Value  any    // pgvector.Vector, or the query text for ocr_text
	Limit  int
}

type RecallScope struct {
	ViewerID   string
	Admin      bool
	Mine       bool    // Only memes in the viewer's library
	FolderPath *string // With Mine, restricts the library to a folder subtree
	Exclude    string  // An asset to leave out
}

// cond filters core.meme_info aliased m down to the scope.
func (s RecallScope) cond(w *filter) string {
	var cond string
	if s.Mine {
		owned := "n.owner_id = " + w.arg(s.ViewerID) + "::uuid"
		if s.FolderPath != nil {
			owned += " AND n.path <@ " + w.arg(*s.FolderPath) + "::ltree"
		}
		cond = "EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = m.asset_id AND " + owned + ")"
	} else {
		cond = memeListed(w, s.ViewerID, s.Admin)
	}
	if s.Exclude != "" {
		cond += " AND m.asset_id <> " + w.arg(s.Exclude) + "::uuid"
	}
	return cond
}

// expr returns the similarity to the query value bound to v, the filter matches pass, and the
// order that lets the HNSW / trigram indexes serve a LIMIT.
func (rc Recall) expr(v string) (similarity, cond, order string) {
	if rc.Column == "ocr_text" {
		return "word_similarity(" + v + ", m.ocr_text)", v + " <% m.ocr_text", "similarity DESC"
	}
	return "1 - (m." + rc.Column + " <=> " + v + ")", "m." + rc.Column + " IS NOT NULL", "m." + rc.Column + " <=> " + v
}

// Recall returns the hits of every channel; a meme found by several channels is listed once per channel.
func (r *MemeRepository) Recall(ctx context.Context, recalls []Recall, scope RecallScope) ([]*model.SearchCandidate, error) {
	if len(recalls) == 0 {
		return nil, nil
	}

	var w filter
	scopeCond := scope.cond(&w)
	subqueries := make([]string, len(recalls))
	for i, rc := range recalls {
		similarity, cond, order := rc.expr(w.arg(rc.Value))
		subqueries[i] = fmt.Sprintf(`(SELECT m.asset_id, m.vlm_json, %s AS similarity, '%s' AS recall_type
			FROM core.meme_info m WHERE %s AND %s ORDER BY %s LIMIT %d)`,
			similarity, rc.Type, cond, scopeCond, order, rc.Limit)
	}

	return collectAll[model.SearchCandidate](r.db.Query(ctx, strings.Join(subqueries, " UNION ALL "), w.args...))
}

// RecallRank returns a meme's similarity in a channel and its rank among the memes in scope the channel
// matches; the rank is nil if the channel does not match the meme at all (below the OCR threshold).
func (r *MemeRepository) RecallRank(ctx context.Context, rc Recall, scope RecallScope, assetID string) (similarity float32, rank *int, err error) {
	var w filter
	scopeCond := scope.cond(&w)
	sim, cond, _ := rc.expr(w.arg(rc.Value))

	query := fmt.Sprintf(`
		WITH t AS (SELECT COALESCE(%[1]s, 0) AS similarity, COALESCE(%[2]s, false) AS matched FROM core.meme_info m WHERE m.asset_id = %[4]s::uuid)
		SELECT t.similarity, CASE WHEN t.matched THEN 1 + (SELECT count(*) FROM core.meme_info m WHERE %[2]s AND %[3]s AND %[1]s > t.similarity) END FROM t
	`, sim, cond, scopeCond, w.arg(assetID))
	err = r.db.QueryRow(ctx, query, w.args...).Scan(&similarity, &rank)
	return
}

func (r *MemeRepository) Captions(ctx context.Context, ids []string) (map[string]json.RawMessage, error) {
	type row struct {
		AssetID string          `db:"asset_id"`
		VLMJSON json.RawMessage `db:"vlm_json"`
	}
	query := `SELECT asset_id::text, vlm_json FROM core.meme_info WHERE asset_id = ANY($1::uuid[]) AND vlm_json IS NOT NULL`
	rows, err := collectAll[row](r.db.Query(ctx, query, ids))

	captions := make(map[string]json.RawMessage, len(rows))
	for _, r := range rows {
		captions[r.AssetID] = r.VLMJSON
	}
	return captions, err
}

func (r *MemeRepository) Vectors(ctx context.Context, assetID string) (metaphor, semantic, clip *pgvector.Vector, err error) {
	query := `SELECT metaphor_vector, semantic_vector, clip_vector FROM core.meme_info WHERE asset_id = $1::uuid`
	err = r.db.QueryRow(ctx, query, assetID).Scan(&metaphor, &semantic, &clip)
	if err == pgx.ErrNoRows {
		err = nil
	}
	return
}
