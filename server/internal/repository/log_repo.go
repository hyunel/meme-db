package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
)

var LogLevels = []string{"debug", "info", "warn", "error"}

type LogRepository struct {
	db db.DBTX
}

func (r *LogRepository) Insert(ctx context.Context, entries []*model.LogEntry) error {
	times := make([]time.Time, len(entries))
	levels := make([]string, len(entries))
	messages := make([]string, len(entries))
	attrs := make([]string, len(entries))
	for i, e := range entries {
		b, err := json.Marshal(e.Attrs)
		if err != nil {
			return err
		}
		times[i], levels[i], messages[i], attrs[i] = e.Time, e.Level, e.Message, string(b)
	}
	query := `
		INSERT INTO ops.logs (time, level, message, attrs)
		SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::jsonb[])
	`
	_, err := r.db.Exec(ctx, query, times, levels, messages, attrs)
	return err
}

func (r *LogRepository) DeleteBefore(ctx context.Context, t time.Time) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM ops.logs WHERE time < $1`, t)
	return tag.RowsAffected(), err
}

type LogFilter struct {
	MinLevel string            // One of LogLevels; empty for all
	Query    string            // Matches the message or any attribute value
	Since    time.Time         // Zero for all time
	Attrs    map[string]string // Attributes that must equal these values (case-insensitive)
}

// List returns entries newer than afterID oldest first, or else older than beforeID (0 = the latest) newest first.
func (r *LogRepository) List(ctx context.Context, f LogFilter, afterID, beforeID int64, limit int) ([]*model.LogEntry, error) {
	var w filter
	if i := slices.Index(LogLevels, f.MinLevel); i > 0 {
		w.where("level = ANY(" + w.arg(LogLevels[i:]) + ")")
	}
	if f.Query != "" {
		p := w.arg("%" + f.Query + "%")
		w.where(fmt.Sprintf("(message ILIKE %[1]s OR EXISTS (SELECT 1 FROM jsonb_each_text(attrs) a WHERE a.value ILIKE %[1]s))", p))
	}
	if !f.Since.IsZero() {
		w.where("time >= " + w.arg(f.Since))
	}
	for k, v := range f.Attrs {
		w.where(fmt.Sprintf("lower(attrs->>%s) = lower(%s)", w.arg(k), w.arg(v)))
	}

	order := "id DESC"
	switch {
	case afterID > 0:
		w.where("id > " + w.arg(afterID))
		order = "id"
	case beforeID > 0:
		w.where("id < " + w.arg(beforeID))
	}
	query := fmt.Sprintf(`SELECT id, time, level, message, attrs FROM ops.logs %s ORDER BY %s LIMIT %d`, w.clause(), order, limit)
	return collectAll[model.LogEntry](r.db.Query(ctx, query, w.args...))
}
