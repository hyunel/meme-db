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

// Counts returns site-wide totals; "new" users are those created within [from, to].
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
			(SELECT count(*) FROM library.tags)
	`, memePublic)

	var o model.Overview
	err := r.db.QueryRow(ctx, query, from, to).Scan(
		&o.Users.Total, &o.Users.Admins, &o.Users.New,
		&o.Memes.Total, &o.Memes.StorageBytes, &o.Memes.Public, &o.Memes.Analyzed, &o.Memes.Pending, &o.Memes.Failed,
		&o.Library.Folders, &o.Library.Files, &o.Library.PublicNodes, &o.Library.Tags,
	)
	return &o, err
}

// Trend counts uploads, sign-ups and finished tasks per day of [from, to] in time zone tz.
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
