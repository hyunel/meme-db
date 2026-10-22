package service

import (
	"archive/zip"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"path"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/storage"
	"github.com/hyunel/MemeDB/internal/repository"
)

// A backup carries a site to a new one: every row of its tables and every stored file, but for what the new site
// works out again (embeddings, and what is found from them) or starts without (sign-ins, the task queue, logs).
// It is a zip of backup.json, tables/<schema.table>.csv and files/<storage path>.
const (
	backupFormat   = 1
	backupInfoName = "backup.json"
	backupTables   = "tables/"
	backupFiles    = "files/"
)

var (
	backupSchemas = []string{"core", "iam", "library"} // jobs and ops hold the task queue and logs
	backupSkipped = []string{"iam.sessions", "core.embedding_models", "library.tag_clusters"}
)

type backupInfo struct {
	Format     int                 `json:"format"`
	Schema     int                 `json:"schema"` // The migration its tables are shaped by
	ExportedAt time.Time           `json:"exported_at"`
	Tables     []*repository.Table `json:"tables"`
}

type BackupStats struct {
	Rows  map[string]int64 // By table
	Files int
	Bytes int64 // Of the files
}

type BackupService struct {
	repo   *repository.Provider
	files  storage.Storage
	assets *AssetService
}

func NewBackupService(repo *repository.Provider, files storage.Storage, assets *AssetService) *BackupService {
	return &BackupService{repo: repo, files: files, assets: assets}
}

func invalidBackup() error {
	return apperror.BadRequest("invalid_backup", "the file is not a MemeDB backup, or is damaged")
}

// Export writes a backup of the database as it is when the backup starts.
func (s *BackupService) Export(ctx context.Context, w io.Writer) (*BackupStats, error) {
	version, err := s.repo.SchemaVersion(ctx)
	if err != nil {
		return nil, err
	}
	info := backupInfo{Format: backupFormat, Schema: version, ExportedAt: time.Now().UTC().Truncate(time.Second)}
	stats := &BackupStats{Rows: make(map[string]int64)}
	zw := zip.NewWriter(w)
	err = s.repo.Snapshot(ctx, func(r *repository.Repos) error {
		var err error
		if info.Tables, err = r.Backup.Tables(ctx, backupSchemas, backupSkipped); err != nil {
			return err
		}
		iw, err := zw.Create(backupInfoName)
		if err != nil {
			return err
		}
		if err := json.NewEncoder(iw).Encode(info); err != nil {
			return err
		}
		for _, t := range info.Tables {
			tw, err := zw.Create(backupTables + t.Name + ".csv")
			if err != nil {
				return err
			}
			if stats.Rows[t.Name], err = r.Backup.CopyOut(ctx, t, tw); err != nil {
				return fmt.Errorf("%s: %w", t.Name, err)
			}
		}
		keys, err := r.Asset.StoragePaths(ctx)
		if err != nil {
			return err
		}
		for _, key := range keys {
			if err := s.exportFile(ctx, zw, key, stats); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return stats, zw.Close()
}

func (s *BackupService) exportFile(ctx context.Context, zw *zip.Writer, key string, stats *BackupStats) error {
	f, err := s.files.Open(ctx, key)
	if errors.Is(err, fs.ErrNotExist) {
		slog.Warn("Backup left out a missing file", "path", key)
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	fw, err := zw.CreateHeader(&zip.FileHeader{Name: backupFiles + key, Method: zip.Store}) // Compressed already
	if err != nil {
		return err
	}
	n, err := io.Copy(fw, f)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", key, err)
	}
	stats.Files++
	stats.Bytes += n
	return nil
}

// Restore loads a backup into an empty database, whose schema it brings to the backup's and then up to date. The
// server works out the embeddings again once it finds none recorded. On an error the database gets none of the rows.
func (s *BackupService) Restore(ctx context.Context, r io.ReaderAt, size int64) (*BackupStats, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, invalidBackup()
	}
	entries := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		entries[f.Name] = f
	}
	var info backupInfo
	if readJSON(entries[backupInfoName], &info) != nil || info.Format != backupFormat {
		return nil, invalidBackup()
	}
	if info.Schema > db.LatestVersion {
		return nil, apperror.BadRequest("backup_too_new", "the backup comes from a newer MemeDB")
	}
	if err := s.prepare(ctx, info); err != nil {
		return nil, err
	}

	stats := &BackupStats{Rows: make(map[string]int64)}
	stored, err := s.restoreFiles(ctx, zr, stats)
	if err == nil {
		err = s.repo.Tx(ctx, func(r *repository.Repos) error {
			if err := r.Backup.DisableTriggers(ctx); err != nil {
				return err
			}
			for _, t := range info.Tables {
				if stats.Rows[t.Name], err = copyIn(ctx, r, t, entries[backupTables+t.Name+".csv"]); err != nil {
					return fmt.Errorf("%s: %w", t.Name, err)
				}
			}
			return nil
		})
	}
	if err != nil {
		s.assets.RemoveFiles(ctx, stored)
		return nil, err
	}
	if err := s.repo.Migrate(ctx, db.LatestVersion); err != nil {
		return nil, err
	}
	return stats, s.resume(ctx)
}

// prepare brings the database's schema to the backup's, refusing one that holds data or has gone past it.
func (s *BackupService) prepare(ctx context.Context, info backupInfo) error {
	notEmpty := apperror.Conflict("database_not_empty", "a backup is restored into an empty database")
	version, err := s.repo.SchemaVersion(ctx)
	if err != nil {
		return err
	}
	if version > info.Schema {
		return notEmpty
	}
	if err := s.repo.Migrate(ctx, info.Schema); err != nil {
		return err
	}
	for _, t := range info.Tables {
		if has, err := s.repo.Backup.HasRows(ctx, t); err != nil || has {
			return cmp.Or(err, error(notEmpty))
		}
	}
	return nil
}

func (s *BackupService) restoreFiles(ctx context.Context, zr *zip.Reader, stats *BackupStats) ([]string, error) {
	var stored []string
	for _, f := range zr.File {
		key, ok := strings.CutPrefix(f.Name, backupFiles)
		if !ok {
			continue
		}
		if !fs.ValidPath(key) {
			return stored, invalidBackup()
		}
		rc, err := f.Open()
		if err != nil {
			return stored, invalidBackup()
		}
		err = s.files.Put(ctx, key, rc, int64(f.UncompressedSize64), mime.TypeByExtension(path.Ext(key)))
		rc.Close()
		if errors.Is(err, zip.ErrChecksum) {
			err = invalidBackup()
		}
		if err != nil {
			return stored, err
		}
		stored = append(stored, key)
		stats.Files++
		stats.Bytes += int64(f.UncompressedSize64)
	}
	return stored, nil
}

func copyIn(ctx context.Context, r *repository.Repos, t *repository.Table, f *zip.File) (int64, error) {
	if f == nil {
		return 0, invalidBackup()
	}
	rc, err := f.Open()
	if err != nil {
		return 0, invalidBackup()
	}
	defer rc.Close()
	return r.Backup.CopyIn(ctx, t, rc)
}

// resume queues again the analyses under way when the backup was made, as the task queue isn't carried, and counts
// the tags' usage.
func (s *BackupService) resume(ctx context.Context) error {
	unfinished := []string{model.ProcessingStatusPending, model.ProcessingStatusProcessing}
	var ids []string
	for _, status := range unfinished {
		found, _, err := s.repo.Meme.FilterIDs(ctx, repository.MemeFilter{Status: status}, nil)
		if err != nil {
			return err
		}
		ids = append(ids, found...)
	}
	err := s.repo.Tx(ctx, func(r *repository.Repos) error {
		queued, err := r.Meme.ResetForAnalysis(ctx, ids, unfinished)
		if err != nil {
			return err
		}
		return enqueueMemeTasks(ctx, r, model.JobAnalyzeMeme, repository.TaskOpts{Priority: model.PriorityNormal}, queued...)
	})
	if err != nil {
		return err
	}
	return s.repo.Tag.RefreshUsage(ctx)
}

func readJSON(f *zip.File, v any) error {
	if f == nil {
		return fs.ErrNotExist
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	return json.NewDecoder(rc).Decode(v)
}
