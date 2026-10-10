package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
)

type MemeRepository struct {
	db db.DBTX
}

// ==============================================================================
// Search
// ==============================================================================

type searchCandidateRow struct {
	AssetID    string     `db:"asset_id"`
	VLMJSON    []byte     `db:"vlm_json"`
	Width      int        `db:"width"`
	Height     int        `db:"height"`
	AnalyzedAt *time.Time `db:"analyzed_at"`
	Similarity float32    `db:"similarity"`
	RecallType string     `db:"recall_type"`
}

func (row *searchCandidateRow) ToModel() *model.SearchCandidate {
	return &model.SearchCandidate{
		MemeInfo: model.MemeInfo{
			AssetID:    row.AssetID,
			VLMJSON:    row.VLMJSON,
			Width:      row.Width,
			Height:     row.Height,
			AnalyzedAt: row.AnalyzedAt,
		},
		Similarity: row.Similarity,
		RecallType: row.RecallType,
	}
}

func (r *MemeRepository) buildRecallQuery(subqueries []string) string {
	if len(subqueries) == 0 {
		return ""
	}
	query := "SELECT DISTINCT ON (asset_id) asset_id, vlm_json, width, height, analyzed_at, similarity, recall_type FROM ("
	for i, sub := range subqueries {
		if i > 0 {
			query += " UNION ALL "
		}
		query += sub
	}
	query += ") AS combined ORDER BY asset_id, similarity DESC"
	return query
}

// SearchSimilar finds similar memes based on vectors from a source asset.
func (r *MemeRepository) SearchSimilar(ctx context.Context, params SearchSimilarParams) ([]*model.SearchCandidate, error) {
	var args []interface{}
	args = append(args, params.SourceAssetID) // $1

	// Use core.meme_view which already handles access control via RLS
	buildSubquery := func(recallType, vectorCol string, threshold float32, limit int) string {
		sourceVec := fmt.Sprintf("(SELECT %s FROM core.meme_view WHERE asset_id = $1::uuid)", vectorCol)
		similarity := fmt.Sprintf("1 - (m.%s <=> %s)", vectorCol, sourceVec)
		where := fmt.Sprintf("WHERE m.asset_id != $1::uuid AND m.%s IS NOT NULL", vectorCol)
		if threshold > 0 {
			where += fmt.Sprintf(" AND %s >= %f", similarity, threshold)
		}
		return fmt.Sprintf(`
			(SELECT m.asset_id, m.vlm_json, m.width, m.height, m.analyzed_at, %s as similarity, '%s' as recall_type
			 FROM core.meme_view m %s ORDER BY similarity DESC LIMIT %d)`,
			similarity, recallType, where, limit)
	}

	var subqueries []string
	if params.Metaphor.Enabled {
		subqueries = append(subqueries, buildSubquery("metaphor", "metaphor_vector", params.Metaphor.Threshold, params.Metaphor.Limit))
	}
	if params.Semantic.Enabled {
		subqueries = append(subqueries, buildSubquery("semantic", "semantic_vector", params.Semantic.Threshold, params.Semantic.Limit))
	}
	if params.Clip.Enabled {
		subqueries = append(subqueries, buildSubquery("clip", "clip_vector", params.Clip.Threshold, params.Clip.Limit))
	}

	query := r.buildRecallQuery(subqueries)
	if query == "" {
		return nil, nil
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	candidates, err := pgx.CollectRows(rows, pgx.RowToStructByName[searchCandidateRow])
	if err != nil {
		return nil, err
	}
	result := make([]*model.SearchCandidate, len(candidates))
	for i, c := range candidates {
		result[i] = c.ToModel()
	}
	return result, nil
}

// SearchCombined performs multi-channel search with text/image vectors.
func (r *MemeRepository) SearchCombined(ctx context.Context, params SearchCombinedParams) ([]*model.SearchCandidate, error) {
	var args []interface{}
	var scopeFilter string

	// Build scope filter - core.meme_view already handles base access control
	if params.FolderPath != nil {
		args = append(args, *params.FolderPath) // $1
		scopeFilter = "AND EXISTS (SELECT 1 FROM library.nodes n WHERE n.asset_id = m.asset_id AND n.path <@ $1::ltree)"
	} else if params.Scope == "my" {
		scopeFilter = "AND m.in_library = true"
	}
	// Global scope: no additional filter needed, meme_view handles it

	buildSubquery := func(recallType, vectorCol string, value interface{}, threshold float32, limit int) string {
		paramIdx := len(args) + 1
		args = append(args, value)

		where := fmt.Sprintf("WHERE m.%s IS NOT NULL", vectorCol)
		var similarity string
		if vectorCol == "ocr_text" {
			similarity = fmt.Sprintf("similarity(m.ocr_text, $%d)", paramIdx)
			if threshold > 0 {
				where += fmt.Sprintf(" AND similarity(m.ocr_text, $%d) >= %f", paramIdx, threshold)
			}
		} else {
			similarity = fmt.Sprintf("1 - (m.%s <=> $%d)", vectorCol, paramIdx)
			if threshold > 0 {
				where += fmt.Sprintf(" AND 1 - (m.%s <=> $%d) >= %f", vectorCol, paramIdx, threshold)
			}
		}

		return fmt.Sprintf(`
			(SELECT m.asset_id, m.vlm_json, m.width, m.height, m.analyzed_at, %s as similarity, '%s' as recall_type
			 FROM core.meme_view m %s %s ORDER BY similarity DESC LIMIT %d)`,
			similarity, recallType, where, scopeFilter, limit)
	}

	var subqueries []string
	if params.Metaphor.Enabled {
		subqueries = append(subqueries, buildSubquery("metaphor", "metaphor_vector", params.Metaphor.Value, params.Metaphor.Threshold, params.Metaphor.Limit))
	}
	if params.Semantic.Enabled {
		subqueries = append(subqueries, buildSubquery("semantic", "semantic_vector", params.Semantic.Value, params.Semantic.Threshold, params.Semantic.Limit))
	}
	if params.ClipText.Enabled {
		subqueries = append(subqueries, buildSubquery("clip_text", "clip_vector", params.ClipText.Value, params.ClipText.Threshold, params.ClipText.Limit))
	}
	if params.OCR.Enabled {
		subqueries = append(subqueries, buildSubquery("ocr", "ocr_text", params.OCR.Value, params.OCR.Threshold, params.OCR.Limit))
	}
	if params.ClipImage.Enabled {
		subqueries = append(subqueries, buildSubquery("clip_image", "clip_vector", params.ClipImage.Value, params.ClipImage.Threshold, params.ClipImage.Limit))
	}

	query := r.buildRecallQuery(subqueries)
	if query == "" {
		return nil, nil
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	candidates, err := pgx.CollectRows(rows, pgx.RowToStructByName[searchCandidateRow])
	if err != nil {
		return nil, err
	}
	result := make([]*model.SearchCandidate, len(candidates))
	for i, c := range candidates {
		result[i] = c.ToModel()
	}
	return result, nil
}

// ==============================================================================
// CRUD
// ==============================================================================

func (r *MemeRepository) Create(ctx context.Context, meme *model.MemeInfo) error {
	query := `
		INSERT INTO core.meme_info (asset_id, vlm_json, ocr_text, metaphor_vector, semantic_vector, clip_vector, width, height, processing_status, analyzed_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (asset_id) DO UPDATE SET
			vlm_json = EXCLUDED.vlm_json, ocr_text = EXCLUDED.ocr_text,
			metaphor_vector = EXCLUDED.metaphor_vector, semantic_vector = EXCLUDED.semantic_vector, clip_vector = EXCLUDED.clip_vector,
			width = EXCLUDED.width, height = EXCLUDED.height,
			processing_status = EXCLUDED.processing_status, analyzed_at = EXCLUDED.analyzed_at
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

func (r *MemeRepository) UpdateStatus(ctx context.Context, assetID string, status string) error {
	_, err := r.db.Exec(ctx, `UPDATE core.meme_info SET processing_status = $2 WHERE asset_id = $1::uuid`, assetID, status)
	return err
}

// ==============================================================================
// Views
// ==============================================================================

type memeViewRow struct {
	AssetID          string     `db:"asset_id"`
	Width            int        `db:"width"`
	Height           int        `db:"height"`
	AnalyzedAt       *time.Time `db:"analyzed_at"`
	FileSize         int64      `db:"file_size"`
	MimeType         string     `db:"mime_type"`
	Extension        string     `db:"extension"`
	CreatedAt        time.Time  `db:"created_at"`
	ProcessingStatus string     `db:"processing_status"`
	InLibrary        bool       `db:"in_library"`
}

func (row *memeViewRow) ToModel() *model.MemeView {
	return &model.MemeView{
		AssetID:          row.AssetID,
		Width:            row.Width,
		Height:           row.Height,
		AnalyzedAt:       row.AnalyzedAt,
		FileSize:         row.FileSize,
		MimeType:         row.MimeType,
		Extension:        row.Extension,
		CreatedAt:        row.CreatedAt,
		ProcessingStatus: row.ProcessingStatus,
		InLibrary:        row.InLibrary,
		Tags:             make([]*model.Tag, 0),
	}
}

// GetViews returns enriched meme views for the given asset IDs.
// Uses meme_view which handles access control via RLS.
func (r *MemeRepository) GetViews(ctx context.Context, assetIDs []string) (map[string]*model.MemeView, error) {
	if len(assetIDs) == 0 {
		return make(map[string]*model.MemeView), nil
	}

	query := `
		SELECT asset_id, width, height, analyzed_at, file_size, mime_type, extension, created_at, processing_status, in_library
		FROM core.meme_view
		WHERE asset_id = ANY($1::uuid[])
	`

	rows, err := r.db.Query(ctx, query, assetIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch memes: %w", err)
	}
	viewRows, err := pgx.CollectRows(rows, pgx.RowToStructByName[memeViewRow])
	if err != nil {
		return nil, fmt.Errorf("failed to scan meme rows: %w", err)
	}

	memes := make(map[string]*model.MemeView)
	for _, row := range viewRows {
		memes[row.AssetID] = row.ToModel()
	}
	return memes, nil
}

// ResetFailed moves failed memes back to pending and returns the IDs actually reset;
// memes in any other status are left untouched.
func (r *MemeRepository) ResetFailed(ctx context.Context, assetIDs []string) ([]string, error) {
	query := `
		UPDATE core.meme_info SET processing_status = 'pending', analyzed_at = NULL
		WHERE asset_id = ANY($1::uuid[]) AND processing_status = 'failed'
		RETURNING asset_id::text
	`
	rows, err := r.db.Query(ctx, query, assetIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to reset meme status: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
