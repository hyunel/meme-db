package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
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
			 JOIN nodes n ON m.asset_id = n.asset_id
			 %s
			 ORDER BY similarity DESC
			 LIMIT %d)`, selectSimilarity, recallType, where, limit)
	}

	var subqueries []string
	if params.Metaphor.Enabled {
		subqueries = append(subqueries, buildSubquery("metaphor", "metaphor_vector", params.Metaphor.Value, params.Metaphor.Threshold, params.Metaphor.Limit))
	}
	if params.Semantic.Enabled {
		subqueries = append(subqueries, buildSubquery("semantic", "semantic_vector", params.Semantic.Value, params.Semantic.Threshold, params.Semantic.Limit))
	}
	if params.Clip.Enabled {
		subqueries = append(subqueries, buildSubquery("clip", "clip_vector", params.Clip.Value, params.Clip.Threshold, params.Clip.Limit))
	}
	if params.OCR.Enabled {
		subqueries = append(subqueries, buildSubquery("ocr", "ocr_text", params.OCR.Value, params.OCR.Threshold, params.OCR.Limit))
	}

	if len(subqueries) == 0 {
		return nil, nil
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

func (r *MemeRepository) GetPendingMemes(ctx context.Context, startID string, limit int) ([]*model.MemeInfo, error) {
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

func (r *MemeRepository) GetMemeDTOs(ctx context.Context, assetIDs []string, ownerID string) (map[string]*model.MemeDTO, error) {
	if len(assetIDs) == 0 {
		return make(map[string]*model.MemeDTO), nil
	}

	query := `
		SELECT
			mi.asset_id::text, mi.width, mi.height, mi.analyzed_at,
			EXISTS(SELECT 1 FROM nodes n WHERE n.asset_id = mi.asset_id AND n.owner_id = $2::uuid) as in_library,
			COALESCE((
				SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'created_at', t.created_at))
				FROM asset_tags at
				JOIN tags t ON at.tag_id = t.id
				WHERE at.asset_id = mi.asset_id
				  AND (at.user_id IS NULL OR at.user_id = $2::uuid)
			), '[]'::json) as tags
		FROM meme_info mi
		JOIN assets a ON mi.asset_id = a.id
		WHERE mi.asset_id = ANY($1::uuid[])
		  AND (a.public_ref_count > 0 OR EXISTS(SELECT 1 FROM nodes n WHERE n.asset_id = mi.asset_id AND n.owner_id = $2::uuid))
	`
	rows, err := r.db.Query(ctx, query, assetIDs, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch meme dtos: %w", err)
	}
	defer rows.Close()

	dtos := make(map[string]*model.MemeDTO)
	for rows.Next() {
		var assetID string
		dto := &model.MemeDTO{}
		err := rows.Scan(
			&assetID, &dto.Width, &dto.Height, &dto.AnalyzedAt,
			&dto.InLibrary, &dto.Tags,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan meme dto: %w", err)
		}
		dto.AssetID = assetID
		dtos[assetID] = dto
	}

	return dtos, nil
}
