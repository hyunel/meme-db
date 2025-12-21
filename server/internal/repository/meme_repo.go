package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
)

type MemeRepository struct {
	db db.DBTX
}

func NewMemeRepository(db db.DBTX) *MemeRepository {
	return &MemeRepository{db: db}
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

type SearchResult struct {
	model.MemeInfo
	Similarity float32 `json:"similarity"`
}

func (r *MemeRepository) SearchByVector(ctx context.Context, vectorColumn string, queryVector pgvector.Vector, limit int, scope string, ownerID string, folderPath *string) ([]SearchResult, error) {
	validColumns := map[string]bool{
		"metaphor_vector": true,
		"semantic_vector": true,
		"clip_vector":     true,
	}
	if !validColumns[vectorColumn] {
		return nil, fmt.Errorf("invalid vector column: %s", vectorColumn)
	}

	whereClause := "WHERE 1=1"
	var args []interface{}
	args = append(args, queryVector) // $1

	if scope == "my" {
		whereClause += " AND n.owner_id = $2::uuid"
		args = append(args, ownerID) // $2
	} else {
		// global: only public files or my files
		whereClause += " AND (n.visibility = 'PUBLIC' OR n.owner_id = $2::uuid)"
		args = append(args, ownerID) // $2
	}

	if folderPath != nil {
		whereClause += fmt.Sprintf(" AND n.path <@ $%d::ltree", len(args)+1)
		args = append(args, *folderPath)
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT ON (m.asset_id) m.asset_id, m.vlm_json, m.ocr_text, m.analyzed_at,
		       1 - (m.%s <=> $1) as similarity
		FROM meme_info m
		JOIN nodes n ON m.asset_id = n.asset_id
		%s
		ORDER BY m.asset_id, m.%s <=> $1
		LIMIT $%d
	`, vectorColumn, whereClause, vectorColumn, len(args)+1)
	args = append(args, limit)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var sr SearchResult
		err := rows.Scan(
			&sr.AssetID, &sr.VLMJSON, &sr.OCRText, &sr.AnalyzedAt,
			&sr.Similarity,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, sr)
	}
	return results, nil
}

func (r *MemeRepository) SearchByOCR(ctx context.Context, textQuery string, limit int, scope string, ownerID string, folderPath *string) ([]SearchResult, error) {
	whereClause := "WHERE m.ocr_text IS NOT NULL"
	var args []interface{}
	args = append(args, textQuery) // $1

	if scope == "my" {
		whereClause += " AND n.owner_id = $2::uuid"
		args = append(args, ownerID) // $2
	} else {
		whereClause += " AND (n.visibility = 'PUBLIC' OR n.owner_id = $2::uuid)"
		args = append(args, ownerID) // $2
	}

	if folderPath != nil {
		whereClause += fmt.Sprintf(" AND n.path <@ $%d::ltree", len(args)+1)
		args = append(args, *folderPath)
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT ON (m.asset_id) m.asset_id, m.vlm_json, m.ocr_text, m.analyzed_at,
		       similarity(m.ocr_text, $1) as similarity
		FROM meme_info m
		JOIN nodes n ON m.asset_id = n.asset_id
		%s
		ORDER BY m.asset_id, similarity(m.ocr_text, $1) DESC
		LIMIT $%d
	`, whereClause, len(args)+1)
	args = append(args, limit)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var sr SearchResult
		err := rows.Scan(
			&sr.AssetID, &sr.VLMJSON, &sr.OCRText, &sr.AnalyzedAt,
			&sr.Similarity,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, sr)
	}
	return results, nil
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
		SELECT asset_id, vlm_json, analyzed_at
		FROM meme_info
		WHERE asset_id >= $1::uuid AND analyzed_at IS NULL
		ORDER BY asset_id ASC
		LIMIT $2
		FOR UPDATE SKIP LOCKED
	`
	rows, err := r.db.Query(ctx, query, startID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memes []*model.MemeInfo
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
