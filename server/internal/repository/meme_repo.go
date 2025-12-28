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

func NewMemeRepository(db db.DBTX) *MemeRepository {
	return &MemeRepository{db: db}
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

func (r *MemeRepository) buildRecallQuery(subqueries []string, args []interface{}) (string, []interface{}) {
	if len(subqueries) == 0 {
		return "", nil
	}

	query := "SELECT DISTINCT ON (asset_id) asset_id, vlm_json, width, height, analyzed_at, similarity, recall_type FROM ("
	for i, sub := range subqueries {
		if i > 0 {
			query += " UNION ALL "
		}
		query += sub
	}
	query += ") AS combined ORDER BY asset_id, similarity DESC"

	return query, args
}

func (r *MemeRepository) SearchSimilar(ctx context.Context, params SearchSimilarParams) ([]*model.SearchCandidate, error) {
	var args []interface{}
	// Use JOIN on assets for efficient property access, and EXISTS for nodes to avoid duplicates.
	joinClause := "JOIN assets a ON m.asset_id = a.id"
	commonWhere := "WHERE m.asset_id != $1::uuid"
	args = append(args, params.SourceAssetID) // $1

	if params.OwnerID != "" {
		commonWhere += " AND (a.public_ref_count > 0 OR EXISTS (SELECT 1 FROM nodes n WHERE n.asset_id = m.asset_id AND n.owner_id = $2::uuid))"
		args = append(args, params.OwnerID) // $2
	} else {
		commonWhere += " AND a.public_ref_count > 0"
	}

	// Helper to build subquery for each channel
	buildSubquery := func(recallType string, vectorCol string, threshold float32, limit int) string {
		// Note: We use $1 (SourceAssetID) directly in the sub-select
		where := commonWhere + fmt.Sprintf(" AND m.%s IS NOT NULL", vectorCol)

		// Subquery to get source vector: (SELECT vectorCol FROM meme_info WHERE asset_id = $1)
		sourceVectorSQL := fmt.Sprintf("(SELECT %s FROM meme_info WHERE asset_id = $1::uuid)", vectorCol)

		// Similarity calculation: 1 - (m.vector <=> source_vector)
		similaritySQL := fmt.Sprintf("1 - (m.%s <=> %s)", vectorCol, sourceVectorSQL)

		if threshold > 0 {
			where += fmt.Sprintf(" AND %s >= %f", similaritySQL, threshold)
		}

		return fmt.Sprintf(`
			(SELECT m.asset_id, m.vlm_json, m.width, m.height, m.analyzed_at, %s as similarity, '%s' as recall_type
			 FROM meme_info m
			 %s
			 %s
			 ORDER BY similarity DESC
			 LIMIT %d)`, similaritySQL, recallType, joinClause, where, limit)
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

	query, finalArgs := r.buildRecallQuery(subqueries, args)
	if query == "" {
		return nil, nil
	}

	rows, err := r.db.Query(ctx, query, finalArgs...)
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

func (r *MemeRepository) SearchCombined(ctx context.Context, params SearchCombinedParams) ([]*model.SearchCandidate, error) {
	var args []interface{}
	var joinClause string
	commonWhere := "WHERE 1=1"

	// 1. Determine Search Scope & Strategy (Using EXISTS)
	if params.FolderPath != nil {
		args = append(args, *params.FolderPath)
		pathIdx := len(args)

		nodeCondition := fmt.Sprintf("n.asset_id = m.asset_id AND n.path <@ $%d::ltree", pathIdx)

		if params.Scope == "my" {
			args = append(args, params.OwnerID)
			ownerIdx := len(args)
			nodeCondition += fmt.Sprintf(" AND n.owner_id = $%d::uuid", ownerIdx)
		} else if params.OwnerID != "" {
			args = append(args, params.OwnerID)
			ownerIdx := len(args)
			nodeCondition += fmt.Sprintf(" AND (n.visibility = 'PUBLIC' OR n.owner_id = $%d::uuid)", ownerIdx)
		} else {
			nodeCondition += " AND n.visibility = 'PUBLIC'"
		}
		commonWhere += fmt.Sprintf(" AND EXISTS (SELECT 1 FROM nodes n WHERE %s)", nodeCondition)
	} else {
		// Global Search (No Folder restriction)
		if params.Scope == "my" {
			args = append(args, params.OwnerID)
			ownerIdx := len(args)
			commonWhere += fmt.Sprintf(" AND EXISTS (SELECT 1 FROM nodes n WHERE n.asset_id = m.asset_id AND n.owner_id = $%d::uuid)", ownerIdx)
		} else {
			// Global Context: Use JOIN assets for public_ref_count
			joinClause = "JOIN assets a ON m.asset_id = a.id"

			if params.OwnerID != "" {
				args = append(args, params.OwnerID)
				ownerIdx := len(args)
				commonWhere += fmt.Sprintf(" AND (a.public_ref_count > 0 OR EXISTS (SELECT 1 FROM nodes n WHERE n.asset_id = m.asset_id AND n.owner_id = $%d::uuid))", ownerIdx)
			} else {
				commonWhere += " AND a.public_ref_count > 0"
			}
		}
	}

	// Helper to build subquery for each channel
	buildSubquery := func(recallType string, vectorCol string, value interface{}, threshold float32, limit int) string {
		paramIdx := len(args) + 1
		args = append(args, value)

		where := commonWhere + fmt.Sprintf(" AND m.%s IS NOT NULL", vectorCol)
		if threshold > 0 {
			if vectorCol == "ocr_text" {
				where += fmt.Sprintf(" AND similarity(m.ocr_text, $%d) >= %f", paramIdx, threshold)
			} else {
				where += fmt.Sprintf(" AND 1 - (m.%s <=> $%d) >= %f", vectorCol, paramIdx, threshold)
			}
		}

		selectSimilarity := ""
		if vectorCol == "ocr_text" {
			selectSimilarity = fmt.Sprintf("similarity(m.ocr_text, $%d)", paramIdx)
		} else {
			selectSimilarity = fmt.Sprintf("1 - (m.%s <=> $%d)", vectorCol, paramIdx)
		}

		return fmt.Sprintf(`
			(SELECT m.asset_id, m.vlm_json, m.width, m.height, m.analyzed_at, %s as similarity, '%s' as recall_type
			 FROM meme_info m
			 %s
			 %s
			 ORDER BY similarity DESC
			 LIMIT %d)`, selectSimilarity, recallType, joinClause, where, limit)
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

	query, finalArgs := r.buildRecallQuery(subqueries, args)
	if query == "" {
		return nil, nil
	}

	rows, err := r.db.Query(ctx, query, finalArgs...)
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

func (r *MemeRepository) CreateMeme(ctx context.Context, meme *model.MemeInfo) error {
	query := `
		INSERT INTO meme_info (asset_id, vlm_json, ocr_text, metaphor_vector, semantic_vector, clip_vector, width, height, processing_status, analyzed_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (asset_id) DO UPDATE SET
			vlm_json = EXCLUDED.vlm_json,
			ocr_text = EXCLUDED.ocr_text,
			metaphor_vector = EXCLUDED.metaphor_vector,
			semantic_vector = EXCLUDED.semantic_vector,
			clip_vector = EXCLUDED.clip_vector,
			width = EXCLUDED.width,
			height = EXCLUDED.height,
			processing_status = EXCLUDED.processing_status,
			analyzed_at = EXCLUDED.analyzed_at
	`
	_, err := r.db.Exec(ctx, query,
		meme.AssetID, meme.VLMJSON, meme.OCRText,
		meme.MetaphorVector, meme.SemanticVector, meme.ClipVector,
		meme.Width, meme.Height,
		meme.ProcessingStatus,
		meme.AnalyzedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create/update meme info: %w", err)
	}
	return nil
}

func (r *MemeRepository) UpdateMemeStatus(ctx context.Context, assetID string, status string) error {
	query := `UPDATE meme_info SET processing_status = $2 WHERE asset_id = $1::uuid`
	_, err := r.db.Exec(ctx, query, assetID, status)
	return err
}

func (r *MemeRepository) GetPendingMemes(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error) {
	query := `
		WITH candidates AS (
			SELECT asset_id, vlm_json, analyzed_at
			FROM meme_info
			WHERE ($1 = '' OR asset_id >= $1::uuid) AND processing_status = 'pending'
			ORDER BY asset_id ASC
			LIMIT $2 + 1
			FOR UPDATE SKIP LOCKED
		),
		to_update AS (
			UPDATE meme_info
			SET processing_status = 'processing', analyzed_at = NOW()
			WHERE asset_id IN (SELECT asset_id FROM candidates LIMIT $2)
			RETURNING asset_id
		)
		SELECT c.asset_id, c.vlm_json, c.analyzed_at
		FROM candidates c
		LEFT JOIN to_update tu ON c.asset_id = tu.asset_id
		ORDER BY c.asset_id ASC
	`
	rows, err := r.db.Query(ctx, query, startID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[model.MemeInfo])
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

func (r *MemeRepository) GetMemeViews(ctx context.Context, assetIDs []string, ownerID *string) (map[string]*model.MemeView, error) {
	if len(assetIDs) == 0 {
		return make(map[string]*model.MemeView), nil
	}

	query := fmt.Sprintf(`
		WITH user_library AS (
			SELECT DISTINCT asset_id
			FROM nodes
			WHERE owner_id = $2::uuid AND asset_id = ANY($1::uuid[])
		)
		SELECT
			a.id as asset_id, COALESCE(mi.width, 0) as width, COALESCE(mi.height, 0) as height, mi.analyzed_at,
			a.file_size, a.mime_type, a.extension, a.created_at,
			CASE
				WHEN mi.processing_status = 'processing' AND mi.analyzed_at < NOW() - INTERVAL '%d minutes' THEN 'failed'
				ELSE COALESCE(mi.processing_status, 'pending')
			END as processing_status,
			(ul.asset_id IS NOT NULL) as in_library
		FROM assets a
		LEFT JOIN meme_info mi ON a.id = mi.asset_id
		LEFT JOIN user_library ul ON a.id = ul.asset_id
		WHERE a.id = ANY($1::uuid[])
		  AND (a.public_ref_count > 0 OR ul.asset_id IS NOT NULL)
	`, model.MemeProcessingTimeout)
	rows, err := r.db.Query(ctx, query, assetIDs, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch memes: %w", err)
	}

	viewRows, err := pgx.CollectRows(rows, pgx.RowToStructByName[memeViewRow])
	if err != nil {
		return nil, fmt.Errorf("failed to scan meme rows: %w", err)
	}

	memes := make(map[string]*model.MemeView)
	for _, row := range viewRows {
		view := row.ToModel()
		memes[view.AssetID] = view
	}

	return memes, nil
}

func (r *MemeRepository) ResetMemeStatus(ctx context.Context, assetIDs []string) error {
	query := `UPDATE meme_info SET processing_status = 'pending', analyzed_at = NULL WHERE asset_id = ANY($1::uuid[])`
	_, err := r.db.Exec(ctx, query, assetIDs)
	return err
}
