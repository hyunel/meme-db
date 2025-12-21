package repository

import (
	"context"
	"fmt"

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

func (r *MemeRepository) SearchCombined(ctx context.Context, params SearchCombinedParams) ([]SearchResult, error) {
	var args []interface{}
	commonWhere := "WHERE 1=1"

	if params.Scope == "my" {
		commonWhere += " AND n.owner_id = $1::uuid"
		args = append(args, params.OwnerID) // $1
	} else if params.OwnerID != "" {
		commonWhere += " AND (n.visibility = 'PUBLIC' OR n.owner_id = $1::uuid)"
		args = append(args, params.OwnerID) // $1
	} else {
		commonWhere += " AND n.visibility = 'PUBLIC'"
	}

	if params.FolderPath != nil {
		commonWhere += fmt.Sprintf(" AND n.path <@ $%d::ltree", len(args)+1)
		args = append(args, *params.FolderPath)
	}

	// Helper to build subquery for each channel
	buildSubquery := func(recallType string, vectorCol string, value interface{}, threshold float32, limit int) string {
		paramIdx := len(args) + 1
		args = append(args, value)

		where := commonWhere
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
			 JOIN nodes n ON m.asset_id = n.asset_id
			 %s
			 ORDER BY similarity DESC
			 LIMIT %d)`, selectSimilarity, recallType, where, limit)
	}

	subqueries := []string{
		buildSubquery("metaphor", "metaphor_vector", params.Metaphor.Value, params.Metaphor.Threshold, params.Metaphor.Limit),
		buildSubquery("semantic", "semantic_vector", params.Semantic.Value, params.Semantic.Threshold, params.Semantic.Limit),
		buildSubquery("clip", "clip_vector", params.Clip.Value, params.Clip.Threshold, params.Clip.Limit),
		buildSubquery("ocr", "ocr_text", params.OCR.Value, params.OCR.Threshold, params.OCR.Limit),
	}

	// Correcting query building
	query := "SELECT DISTINCT ON (asset_id) asset_id, vlm_json, width, height, analyzed_at, similarity, recall_type FROM ("
	for i, sub := range subqueries {
		if i > 0 {
			query += " UNION ALL "
		}
		query += sub
	}
	query += ") AS combined ORDER BY asset_id, similarity DESC"

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var sr SearchResult
		err := rows.Scan(
			&sr.AssetID, &sr.VLMJSON, &sr.Width, &sr.Height, &sr.AnalyzedAt,
			&sr.Similarity, &sr.RecallType,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, sr)
	}
	return results, nil
}

func (r *MemeRepository) CreateMeme(ctx context.Context, meme *model.MemeInfo) error {
	query := `
		INSERT INTO meme_info (asset_id, vlm_json, ocr_text, metaphor_vector, semantic_vector, clip_vector, width, height, analyzed_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (asset_id) DO UPDATE SET
			vlm_json = EXCLUDED.vlm_json,
			ocr_text = EXCLUDED.ocr_text,
			metaphor_vector = EXCLUDED.metaphor_vector,
			semantic_vector = EXCLUDED.semantic_vector,
			clip_vector = EXCLUDED.clip_vector,
			width = EXCLUDED.width,
			height = EXCLUDED.height,
			analyzed_at = EXCLUDED.analyzed_at
	`
	_, err := r.db.Exec(ctx, query,
		meme.AssetID, meme.VLMJSON, meme.OCRText,
		meme.MetaphorVector, meme.SemanticVector, meme.ClipVector,
		meme.Width, meme.Height,
		meme.AnalyzedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create/update meme info: %w", err)
	}
	return nil
}

func (r *MemeRepository) GetMeme(ctx context.Context, assetID string) (*model.MemeInfo, error) {
	query := `
		SELECT asset_id, vlm_json, ocr_text, width, height, analyzed_at
		FROM meme_info
		WHERE asset_id = $1::uuid
	`
	var meme model.MemeInfo
	err := r.db.QueryRow(ctx, query, assetID).Scan(
		&meme.AssetID, &meme.VLMJSON, &meme.OCRText, &meme.Width, &meme.Height, &meme.AnalyzedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &meme, nil
}

func (r *MemeRepository) CountMemes(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM meme_info").Scan(&count)
	return count, err
}

func (r *MemeRepository) CountMemesMissingEmbeddings(ctx context.Context) (int64, error) {
	query := `
		SELECT COUNT(*) FROM meme_info
		WHERE metaphor_vector IS NULL OR semantic_vector IS NULL OR clip_vector IS NULL
	`
	var count int64
	err := r.db.QueryRow(ctx, query).Scan(&count)
	return count, err
}

func (r *MemeRepository) GetPendingMemesForUpdate(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error) {
	query := `
		UPDATE meme_info
		SET analyzed_at = NOW()
		WHERE asset_id IN (
			SELECT asset_id
			FROM meme_info
			WHERE asset_id >= $1::uuid AND analyzed_at IS NULL
			ORDER BY asset_id ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		RETURNING asset_id, vlm_json, analyzed_at
	`
	rows, err := r.db.Query(ctx, query, startID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memes := make([]*model.MemeInfo, 0)
	for rows.Next() {
		var m model.MemeInfo
		err := rows.Scan(&m.AssetID, &m.VLMJSON, &m.AnalyzedAt)
		if err != nil {
			return nil, err
		}
		memes = append(memes, &m)
	}
	return memes, nil
}
