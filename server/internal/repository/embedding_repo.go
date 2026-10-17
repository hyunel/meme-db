package repository

import (
	"context"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
)

type EmbeddingRepository struct {
	db db.DBTX
}

// The columns each role's embeddings are stored in, with their indexes
var embeddingColumns = map[string][]struct{ table, column, index string }{
	"clip": {{"core.meme_info", "clip_vector", "idx_meme_clip"}},
	"text_embedding": {
		{"core.meme_info", "metaphor_vector", "idx_meme_meta"},
		{"core.meme_info", "semantic_vector", "idx_meme_sem"},
		{"library.tags", "embedding", "idx_tags_embedding"},
	},
}

// Models names the model each role's stored embeddings come from.
func (r *EmbeddingRepository) Models(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.Query(ctx, `SELECT role, name FROM core.embedding_models`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	models := map[string]string{}
	for rows.Next() {
		var role, name string
		if err := rows.Scan(&role, &name); err != nil {
			return nil, err
		}
		models[role] = name
	}
	return models, rows.Err()
}

// SetModel records the model a role's stored embeddings come from.
func (r *EmbeddingRepository) SetModel(ctx context.Context, role, name string) error {
	query := `INSERT INTO core.embedding_models (role, name) VALUES ($1, $2) ON CONFLICT (role) DO UPDATE SET name = EXCLUDED.name`
	_, err := r.db.Exec(ctx, query, role, name)
	return err
}

// Reset empties a role's embeddings, sized anew for dims dimensions.
func (r *EmbeddingRepository) Reset(ctx context.Context, role string, dims int) error {
	// The new columns are empty: a serial index build is instant, where a parallel one asks for shared memory that
	// containers have little of.
	if _, err := r.db.Exec(ctx, `SET LOCAL max_parallel_maintenance_workers = 0`); err != nil {
		return err
	}
	for _, c := range embeddingColumns[role] {
		// Replacing the column leaves the table unwritten, where changing its type would rewrite it.
		_, err := r.db.Exec(ctx, fmt.Sprintf(`
			ALTER TABLE %[1]s DROP COLUMN %[2]s, ADD COLUMN %[2]s vector(%[3]d);
			CREATE INDEX %[4]s ON %[1]s USING hnsw (%[2]s vector_cosine_ops)
		`, c.table, c.column, dims, c.index))
		if err != nil {
			return err
		}
	}
	return nil
}
