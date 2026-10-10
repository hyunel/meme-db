package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Repos provides access to all repositories over one connection or transaction.
type Repos struct {
	User     *UserRepository
	Meme     *MemeRepository
	Asset    *AssetRepository
	Task     *TaskRepository
	Node     *NodeRepository
	Tag      *TagRepository
	Favorite *FavoriteRepository
	Stats    *StatsRepository
	Log      *LogRepository
}

// NewRepos creates a new Repos instance with the given database connection.
func NewRepos(db db.DBTX) *Repos {
	return &Repos{
		User:     &UserRepository{db: db},
		Meme:     &MemeRepository{db: db},
		Asset:    &AssetRepository{db: db},
		Task:     &TaskRepository{db: db},
		Node:     &NodeRepository{db: db},
		Tag:      &TagRepository{db: db},
		Favorite: &FavoriteRepository{db: db},
		Stats:    &StatsRepository{db: db},
		Log:      &LogRepository{db: db},
	}
}

// Page selects a window of a list.
type Page struct {
	Limit  int
	Offset int
}

// TimeRange bounds a timestamp column; zero values leave that side open.
type TimeRange struct {
	From time.Time
	To   time.Time
}

// ==============================================================================
// Query helpers
// ==============================================================================

// filter accumulates AND-ed SQL conditions with positional arguments.
type filter struct {
	conds []string
	args  []any
}

// arg binds v and returns its placeholder.
func (f *filter) arg(v any) string {
	f.args = append(f.args, v)
	return fmt.Sprintf("$%d", len(f.args))
}

func (f *filter) where(cond string) {
	f.conds = append(f.conds, cond)
}

func (f *filter) timeRange(column string, r TimeRange) {
	if !r.From.IsZero() {
		f.where(column + " >= " + f.arg(r.From))
	}
	if !r.To.IsZero() {
		f.where(column + " <= " + f.arg(r.To))
	}
}

func (f *filter) clause() string {
	if len(f.conds) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(f.conds, " AND ")
}

// prefixed qualifies a comma-separated column list with a table alias.
func prefixed(alias, columns string) string {
	cols := strings.Split(columns, ",")
	for i, c := range cols {
		cols[i] = alias + "." + strings.TrimSpace(c)
	}
	return strings.Join(cols, ", ")
}

func (p Page) clause() string {
	return fmt.Sprintf("LIMIT %d OFFSET %d", p.Limit, p.Offset)
}

// collectOne returns the single row of a query, or nil if there is none.
func collectOne[T any](rows pgx.Rows, err error) (*T, error) {
	if err != nil {
		return nil, err
	}
	v, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[T])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func collectAll[T any](rows pgx.Rows, err error) ([]*T, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[T])
}

func collectScalars[T any](rows pgx.Rows, err error) ([]T, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[T])
}

// collectIDsWithTotal collects (id, total) rows, where total is a count(*) OVER () column.
func collectIDsWithTotal(rows pgx.Rows, err error) ([]string, int, error) {
	if err != nil {
		return nil, 0, err
	}
	var id string
	var ids []string
	total := 0
	_, err = pgx.ForEachRow(rows, []any{&id, &total}, func() error {
		ids = append(ids, id)
		return nil
	})
	return ids, total, err
}

func count(ctx context.Context, q db.DBTX, query string, args ...any) (int, error) {
	var n int
	err := q.QueryRow(ctx, query, args...).Scan(&n)
	return n, err
}

// IsUniqueViolation reports whether err is a unique constraint violation.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// nullable maps an empty ID (e.g. a guest viewer) to SQL NULL.
func nullable(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}
