package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
)

type TagRepository struct {
	db db.DBTX
}

// TagOf finds the tag of a spelling or of one with the same key; labelID is set only if this exact spelling exists.
func (r *TagRepository) TagOf(ctx context.Context, name string) (labelID, tagID string, err error) {
	query := `
		SELECT COALESCE(CASE WHEN name = $1 THEN id::text END, ''), tag_id::text FROM library.labels
		WHERE library.label_key(name) = library.label_key($1)
		ORDER BY name = $1 DESC LIMIT 1
	`
	err = r.db.QueryRow(ctx, query, name).Scan(&labelID, &tagID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return
}

func (r *TagRepository) Nearest(ctx context.Context, embedding pgvector.Vector) (tagID string, similarity float64, err error) {
	query := `
		SELECT id::text, 1 - (embedding <=> $1) FROM library.tags
		WHERE embedding IS NOT NULL ORDER BY embedding <=> $1 LIMIT 1
	`
	err = r.db.QueryRow(ctx, query, embedding).Scan(&tagID, &similarity)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return
}

// Lock holds off changes to the tags until the transaction ends.
func (r *TagRepository) Lock(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `LOCK TABLE library.tags IN SHARE MODE`)
	return err
}

// VLMTags returns the names of the tags the VLM started, which have embeddings.
func (r *TagRepository) VLMTags(ctx context.Context) ([]string, error) {
	return collectScalars[string](r.db.Query(ctx, `SELECT name FROM library.tags WHERE NOT by_user`))
}

// SetEmbeddings gives the tags of names the vectors.
func (r *TagRepository) SetEmbeddings(ctx context.Context, names []string, vectors []pgvector.Vector) error {
	query := `UPDATE library.tags t SET embedding = v.e FROM unnest($1::text[], $2::vector[]) AS v(name, e) WHERE t.name = v.name`
	_, err := r.db.Exec(ctx, query, names, vectors)
	return err
}

// Create returns the tag with this name, which a concurrent resolve may have created first; embedding is nil for a tag a user starts.
func (r *TagRepository) Create(ctx context.Context, name string, embedding *pgvector.Vector) (string, error) {
	query := `
		INSERT INTO library.tags (name, embedding, by_user) VALUES ($1, $2, $3)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id::text
	`
	var id string
	err := r.db.QueryRow(ctx, query, name, embedding, embedding == nil).Scan(&id)
	return id, err
}

// SetLabel maps a new spelling to a tag; an existing one keeps its tag.
func (r *TagRepository) SetLabel(ctx context.Context, name, tagID string) (string, error) {
	query := `
		INSERT INTO library.labels (name, tag_id) VALUES ($1, $2::uuid)
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id::text
	`
	var id string
	err := r.db.QueryRow(ctx, query, name, tagID).Scan(&id)
	return id, err
}

func (r *TagRepository) SetSystemLabels(ctx context.Context, assetID string, labelIDs []string) error {
	if _, err := r.db.Exec(ctx, `DELETE FROM library.asset_tags WHERE asset_id = $1::uuid AND user_id IS NULL`, assetID); err != nil {
		return err
	}
	query := `
		INSERT INTO library.asset_tags (asset_id, label_id) SELECT $1::uuid, unnest($2::uuid[])
		ON CONFLICT DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, assetID, labelIDs)
	return err
}

func (r *TagRepository) AddUserLabel(ctx context.Context, assetID, labelID, userID string) (*model.MemeTag, error) {
	query := `
		WITH link AS (
			INSERT INTO library.asset_tags (asset_id, label_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING
		)
		SELECT t.id::text, t.name FROM library.labels l JOIN library.tags t ON t.id = l.tag_id WHERE l.id = $2::uuid
	`
	tag := &model.MemeTag{Mine: true}
	err := r.db.QueryRow(ctx, query, assetID, labelID, userID).Scan(&tag.ID, &tag.Name)
	return tag, err
}

func (r *TagRepository) RemoveUserTag(ctx context.Context, assetID, tagID, userID string) error {
	query := `
		DELETE FROM library.asset_tags at USING library.labels l
		WHERE l.id = at.label_id AND at.asset_id = $1::uuid AND l.tag_id = $2::uuid AND at.user_id = $3::uuid
	`
	_, err := r.db.Exec(ctx, query, assetID, tagID, userID)
	return err
}

// Hot lists the tags on the most public memes, as last counted.
func (r *TagRepository) Hot(ctx context.Context, minUsage, limit int) ([]string, error) {
	query := `
		SELECT t.name FROM library.tag_usage u JOIN library.tags t ON t.id = u.tag_id
		WHERE NOT t.hidden AND u.public_usage >= $1
		ORDER BY u.public_usage DESC, t.name LIMIT $2
	`
	return collectScalars[string](r.db.Query(ctx, query, minUsage, limit))
}

func (r *TagRepository) RefreshUsage(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY library.tag_usage`)
	return err
}

func (r *TagRepository) List(ctx context.Context, query, sort string, page Page, commonShare float64) ([]*model.TagUsage, int, error) {
	var w filter
	w.where("NOT t.by_user") // Tags users started are left to them
	if query != "" {
		w.where("EXISTS (SELECT 1 FROM library.labels l WHERE l.tag_id = t.id AND l.name ILIKE " + w.arg("%"+query+"%") + ")")
	}
	total, err := count(ctx, r.db, "SELECT count(*) FROM library.tags t "+w.clause(), w.args...)
	if err != nil {
		return nil, 0, err
	}

	order := map[string]string{"name": "name", "created": "created_at DESC"}[sort]
	if order == "" {
		order = "usage DESC, name"
	}
	tags, err := r.usages(ctx, w, order+" "+page.clause(), commonShare)
	return tags, total, err
}

func (r *TagRepository) Get(ctx context.Context, ids []string, commonShare float64) ([]*model.TagUsage, error) {
	var w filter
	w.where("t.id = ANY(" + w.arg(ids) + "::uuid[])")
	return r.usages(ctx, w, "usage DESC, name", commonShare)
}

func (r *TagRepository) usages(ctx context.Context, w filter, order string, commonShare float64) ([]*model.TagUsage, error) {
	query := fmt.Sprintf(`
		SELECT u.*, u.usage > %s::float8 * (SELECT count(*) FROM core.meme_info WHERE processing_status = 'success') AS common
		FROM (
			SELECT t.id, t.name, t.hidden, t.created_at,
				ARRAY(SELECT l.name FROM library.labels l WHERE l.tag_id = t.id AND l.name <> t.name ORDER BY l.name) AS aliases,
				(SELECT count(DISTINCT at.asset_id) FROM library.asset_tags at JOIN library.labels l ON l.id = at.label_id
				 WHERE l.tag_id = t.id) AS usage
			FROM library.tags t %s
		) u ORDER BY %s
	`, w.arg(commonShare), w.clause(), order)
	return collectAll[model.TagUsage](r.db.Query(ctx, query, w.args...))
}

// SimilarPairs finds pairs of tags at least minSimilarity alike among each tag's nearest neighbours.
func (r *TagRepository) SimilarPairs(ctx context.Context, minSimilarity float64) ([][2]string, error) {
	query := `
		SELECT DISTINCT LEAST(a.id, n.id)::text, GREATEST(a.id, n.id)::text FROM library.tags a
		CROSS JOIN LATERAL (
			SELECT b.id, b.embedding FROM library.tags b WHERE b.id <> a.id AND b.embedding IS NOT NULL
			ORDER BY b.embedding <=> a.embedding LIMIT 20
		) n
		WHERE a.embedding IS NOT NULL AND 1 - (a.embedding <=> n.embedding) >= $1
	`
	rows, err := r.db.Query(ctx, query, minSimilarity)
	if err != nil {
		return nil, err
	}
	var pair [2]string
	var pairs [][2]string
	_, err = pgx.ForEachRow(rows, []any{&pair[0], &pair[1]}, func() error {
		pairs = append(pairs, pair)
		return nil
	})
	return pairs, err
}

// SetClusters replaces the clusters of tags suggested as duplicates.
func (r *TagRepository) SetClusters(ctx context.Context, clusters [][]string) error {
	if _, err := r.db.Exec(ctx, `DELETE FROM library.tag_clusters`); err != nil {
		return err
	}
	var ids []string
	var nums []int
	for i, c := range clusters {
		for _, id := range c {
			ids = append(ids, id)
			nums = append(nums, i)
		}
	}
	_, err := r.db.Exec(ctx, `INSERT INTO library.tag_clusters (tag_id, cluster) SELECT * FROM unnest($1::uuid[], $2::int[])`, ids, nums)
	return err
}

// Clusters maps each tag suggested as a duplicate to its cluster.
func (r *TagRepository) Clusters(ctx context.Context) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `SELECT tag_id::text, cluster FROM library.tag_clusters`)
	if err != nil {
		return nil, err
	}
	var id string
	var cluster int
	clusters := map[string]int{}
	_, err = pgx.ForEachRow(rows, []any{&id, &cluster}, func() error {
		clusters[id] = cluster
		return nil
	})
	return clusters, err
}

func (r *TagRepository) Embeddings(ctx context.Context, ids []string) (map[string][]float32, error) {
	rows, err := r.db.Query(ctx, `SELECT id::text, embedding FROM library.tags WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	var id string
	var v pgvector.Vector
	embeddings := make(map[string][]float32, len(ids))
	_, err = pgx.ForEachRow(rows, []any{&id, &v}, func() error {
		embeddings[id] = v.Slice()
		return nil
	})
	return embeddings, err
}

func (r *TagRepository) Rename(ctx context.Context, id, name string) error {
	_, err := r.db.Exec(ctx, `UPDATE library.tags SET name = $2 WHERE id = $1::uuid`, id, name)
	return err
}

func (r *TagRepository) SetHidden(ctx context.Context, id string, hidden bool) error {
	_, err := r.db.Exec(ctx, `UPDATE library.tags SET hidden = $2 WHERE id = $1::uuid`, id, hidden)
	return err
}

// Merge moves the sources' spellings, and with them their links, to the target.
// UserTags returns the names of the tags among ids that users started.
func (r *TagRepository) UserTags(ctx context.Context, ids []string) ([]string, error) {
	return collectScalars[string](r.db.Query(ctx, `SELECT name FROM library.tags WHERE id = ANY($1::uuid[]) AND by_user`, ids))
}

func (r *TagRepository) Merge(ctx context.Context, sourceIDs []string, targetID string) error {
	if _, err := r.db.Exec(ctx, `UPDATE library.labels SET tag_id = $2::uuid WHERE tag_id = ANY($1::uuid[])`, sourceIDs, targetID); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `DELETE FROM library.tags WHERE id = ANY($1::uuid[]) AND id <> $2::uuid`, sourceIDs, targetID)
	return err
}

func (r *TagRepository) Delete(ctx context.Context, ids []string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM library.tags WHERE id = ANY($1::uuid[])`, ids)
	return err
}
