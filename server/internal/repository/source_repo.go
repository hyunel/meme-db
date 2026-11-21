package repository

import (
	"context"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

type SourceRepository struct {
	db db.DBTX
}

// List counts the uses of the longest popularity window.
func (r *SourceRepository) List(ctx context.Context) ([]*model.Source, error) {
	query := `
		SELECT s.name, s.created_at,
			(SELECT count(DISTINCT at.asset_id) FROM library.asset_tags at WHERE at.source = s.name)::int AS tagged,
			e.used, e.uses
		FROM core.sources s
		CROSS JOIN LATERAL (
			SELECT count(DISTINCT (ev.asset_id, ev.node_id))::int AS used, count(*) AS uses
			FROM core.events ev
			WHERE ev.source = s.name AND ev.kind = 'use' AND ev.at >= CURRENT_TIMESTAMP - make_interval(secs => $1)
		) e
		ORDER BY s.created_at
	`
	return collectAll[model.Source](r.db.Query(ctx, query, int64(model.PeriodMonth.Window().Seconds())))
}

func (r *SourceRepository) Ensure(ctx context.Context, names ...string) error {
	if len(names) == 0 {
		return nil
	}
	_, err := r.db.Exec(ctx, `INSERT INTO core.sources (name)
		SELECT DISTINCT unnest($1::text[]) ORDER BY 1 ON CONFLICT DO NOTHING`, names)
	return err
}

// Delete takes a source away with the tags it gave; false if there was none.
func (r *SourceRepository) Delete(ctx context.Context, name string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM core.sources WHERE name = $1`, name)
	return tag.RowsAffected() > 0, err
}
