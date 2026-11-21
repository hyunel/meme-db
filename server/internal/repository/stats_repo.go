package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

type StatsRepository struct {
	db db.DBTX
}

// recountWindows counts day, week and month for every row of a stats table, %[2]s, keyed by %[1]s.
const recountWindows = `
	WITH counted AS (
		SELECT %[1]s AS id,
			count(*) FILTER (WHERE at >= $2) AS day,
			count(*) FILTER (WHERE at >= $3) AS week,
			count(*) FILTER (WHERE at >= $4) AS month
		FROM core.events
		WHERE kind = 'use' AND %[1]s IS NOT NULL AND at >= $4 AND at < $1
		GROUP BY 1
	), totals AS (
		SELECT r.%[1]s AS id, COALESCE(c.day, 0) AS day, COALESCE(c.week, 0) AS week, COALESCE(c.month, 0) AS month
		FROM %[2]s r LEFT JOIN counted c ON c.id = r.%[1]s
	)
	UPDATE %[2]s s SET day = totals.day, week = totals.week, month = totals.month
	FROM totals
	WHERE s.%[1]s = totals.id AND (s.day, s.week, s.month) IS DISTINCT FROM (totals.day, totals.week, totals.month)`

// RefreshWindows recounts day, week and month from the events of the longest window, writing them: a missed run
// leaves no trace.
func (r *StatsRepository) RefreshWindows(ctx context.Context, now time.Time) error {
	args := []any{now, now.Add(-model.PeriodDay.Window()), now.Add(-model.PeriodWeek.Window()), now.Add(-model.PeriodMonth.Window())}
	for _, t := range []struct{ stats, key string }{
		{"core.meme_stats", "asset_id"},
		{"library.folder_stats", "node_id"},
	} {
		if _, err := r.db.Exec(ctx, fmt.Sprintf(recountWindows, t.key, t.stats), args...); err != nil {
			return err
		}
	}
	return nil
}

func (r *StatsRepository) Counts(ctx context.Context, from, to time.Time) (*model.Overview, error) {
	query := fmt.Sprintf(`
		SELECT
			(SELECT count(*) FROM iam.users),
			(SELECT count(*) FROM iam.users WHERE role = 'admin'),
			(SELECT count(*) FROM iam.users WHERE created_at BETWEEN $1 AND $2),
			(SELECT count(*) FROM core.assets),
			(SELECT COALESCE(sum(file_size), 0) FROM core.assets),
			(SELECT count(*) FROM core.meme_info m WHERE %s),
			(SELECT count(*) FROM core.meme_info WHERE processing_status = 'success'),
			(SELECT count(*) FROM core.meme_info WHERE processing_status IN ('pending', 'processing')),
			(SELECT count(*) FROM core.meme_info WHERE processing_status = 'failed'),
			(SELECT count(*) FROM library.nodes WHERE type = 'FOLDER'),
			(SELECT count(*) FROM library.nodes WHERE type = 'FILE'),
			(SELECT count(*) FROM library.nodes WHERE is_public),
			(SELECT count(*) FROM library.tags t WHERE %s)
	`, memePublic, sourceUses)

	var o model.Overview
	err := r.db.QueryRow(ctx, query, from, to).Scan(
		&o.Users.Total, &o.Users.Admins, &o.Users.New,
		&o.Memes.Total, &o.Memes.StorageBytes, &o.Memes.Public, &o.Memes.Analyzed, &o.Memes.Pending, &o.Memes.Failed,
		&o.Library.Folders, &o.Library.Files, &o.Library.PublicNodes, &o.Library.Tags,
	)
	return &o, err
}

func (r *StatsRepository) Trend(ctx context.Context, from, to time.Time, tz string) ([]*model.TrendPoint, error) {
	query := `
		WITH days AS (
			SELECT generate_series(date_trunc('day', $1::timestamptz, $3), date_trunc('day', $2::timestamptz, $3), interval '1 day') AS d
		),
		uploads AS (
			SELECT date_trunc('day', created_at, $3) AS d, count(*) AS n FROM core.assets
			WHERE created_at BETWEEN $1 AND $2 GROUP BY 1
		),
		users AS (
			SELECT date_trunc('day', created_at, $3) AS d, count(*) AS n FROM iam.users
			WHERE created_at BETWEEN $1 AND $2 GROUP BY 1
		),
		tasks AS (
			SELECT date_trunc('day', finished_at, $3) AS d,
				count(*) FILTER (WHERE status = 'completed') AS completed,
				count(*) FILTER (WHERE status = 'failed') AS failed
			FROM jobs.tasks_history WHERE finished_at BETWEEN $1 AND $2 GROUP BY 1
		)
		SELECT to_char(days.d AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
			COALESCE(uploads.n, 0) AS uploads, COALESCE(users.n, 0) AS users,
			COALESCE(tasks.completed, 0) AS completed, COALESCE(tasks.failed, 0) AS failed
		FROM days
		LEFT JOIN uploads USING (d)
		LEFT JOIN users USING (d)
		LEFT JOIN tasks USING (d)
		ORDER BY days.d
	`
	return collectAll[model.TrendPoint](r.db.Query(ctx, query, from, to, tz))
}

// rankedIDs uses the same filters and snapshot for the anchor and its following page.
func rankedIDs(ctx context.Context, q db.DBTX, from, key string, period model.Period, cursor string, w filter, limit int) ([]string, bool, error) {
	if period.Window() == 0 {
		return nil, false, fmt.Errorf("unknown popularity period %q", period)
	}
	score := "s." + string(period)
	if cursor == "" {
		query := fmt.Sprintf("SELECT %s::text FROM %s %s ORDER BY %s DESC, %s DESC LIMIT %d", key, from, w.clause(), score, key, limit)
		ids, err := collectScalars[string](q.Query(ctx, query, w.args...))
		return ids, true, err
	}
	anchor := w.arg(cursor)
	query := fmt.Sprintf(`
	WITH anchor AS (
		SELECT %[1]s AS id, %[2]s AS score FROM %[3]s %[4]s AND %[1]s = %[5]s::uuid
	), page AS (
		SELECT %[1]s AS id, %[2]s AS score FROM %[3]s %[4]s
		AND (%[2]s, %[1]s) < (SELECT score, id FROM anchor)
		ORDER BY %[2]s DESC, %[1]s DESC LIMIT %[6]d
	)
	SELECT ARRAY(SELECT id::text FROM page ORDER BY score DESC, id DESC), EXISTS (SELECT 1 FROM anchor)
`, key, score, from, w.clause(), anchor, limit)
	var ids []string
	var valid bool
	err := q.QueryRow(ctx, query, w.args...).Scan(&ids, &valid)
	return ids, valid, err
}

func (r *StatsRepository) InitStats(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
	INSERT INTO core.meme_stats (asset_id) SELECT id FROM core.assets ON CONFLICT DO NOTHING;
	INSERT INTO library.folder_stats (node_id) SELECT id FROM library.nodes WHERE type = 'FOLDER' ON CONFLICT DO NOTHING;
`)
	return err
}
