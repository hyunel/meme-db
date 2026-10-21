package repository

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Table is a table a backup holds, with the columns it keeps.
type Table struct {
	Name    string   `db:"name" json:"name"` // schema.table
	Columns []string `db:"columns" json:"columns"`
}

type BackupRepository struct {
	db db.DBTX
}

// Tables lists the tables of the schemas but for those skipped, with their columns but the vectors: those hold
// embeddings, which the server works out again.
func (r *BackupRepository) Tables(ctx context.Context, schemas, skipped []string) ([]*Table, error) {
	query := `
		SELECT n.nspname || '.' || c.relname AS name, array_agg(a.attname::text ORDER BY a.attnum) AS columns
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
		WHERE c.relkind = 'r' AND NOT c.relispartition AND n.nspname = ANY($1) AND n.nspname || '.' || c.relname <> ALL($2)
			AND a.atttypid <> 'vector'::regtype
		GROUP BY 1 ORDER BY 1
	`
	return collectAll[Table](r.db.Query(ctx, query, schemas, skipped))
}

// HasRows tells whether the table holds a row.
func (r *BackupRepository) HasRows(ctx context.Context, t *Table) (bool, error) {
	var has bool
	err := r.db.QueryRow(ctx, fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %s)`, t.ident())).Scan(&has)
	return has, err
}

// CopyOut writes the table's rows as CSV and returns how many there were.
func (r *BackupRepository) CopyOut(ctx context.Context, t *Table, w io.Writer) (int64, error) {
	conn, err := r.conn()
	if err != nil {
		return 0, err
	}
	tag, err := conn.CopyTo(ctx, w, fmt.Sprintf(`COPY (SELECT %s FROM %s) TO STDOUT WITH (FORMAT csv)`, t.columnList(), t.ident()))
	return tag.RowsAffected(), err
}

// CopyIn adds the rows CopyOut wrote and returns how many there were.
func (r *BackupRepository) CopyIn(ctx context.Context, t *Table, rd io.Reader) (int64, error) {
	conn, err := r.conn()
	if err != nil {
		return 0, err
	}
	tag, err := conn.CopyFrom(ctx, rd, fmt.Sprintf(`COPY %s (%s) FROM STDIN WITH (FORMAT csv)`, t.ident(), t.columnList()))
	return tag.RowsAffected(), err
}

// DisableTriggers lets rows go in as they were, as pg_restore does: until the transaction ends, triggers don't fire
// and foreign keys go unchecked. It takes a superuser.
func (r *BackupRepository) DisableTriggers(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `SET LOCAL session_replication_role = replica`)
	return err
}

// conn is the transaction's connection, which COPY takes to itself.
func (r *BackupRepository) conn() (*pgconn.PgConn, error) {
	tx, ok := r.db.(pgx.Tx)
	if !ok {
		return nil, errors.New("COPY runs in a transaction")
	}
	return tx.Conn().PgConn(), nil
}

func (t *Table) ident() string {
	schema, name, _ := strings.Cut(t.Name, ".")
	return pgx.Identifier{schema, name}.Sanitize()
}

func (t *Table) columnList() string {
	quoted := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		quoted[i] = pgx.Identifier{c}.Sanitize()
	}
	return strings.Join(quoted, ", ")
}
