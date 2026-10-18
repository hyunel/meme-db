package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

type localDir struct {
	root string
}

func (l *localDir) path(key string) string {
	return filepath.Join(l.root, filepath.FromSlash(key))
}

func (l *localDir) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	path := l.path(key)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	// Written on the same filesystem and renamed into place, so no one reads a half-written file.
	tmp, err := os.CreateTemp(l.root, "upload-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmp.Name()) // No-op once renamed into place

	_, err = io.Copy(tmp, r)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("failed to save file: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("failed to store file: %w", err)
	}
	return nil
}

func (l *localDir) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	return os.Open(l.path(key))
}

func (l *localDir) Delete(_ context.Context, key string) error {
	if err := os.Remove(l.path(key)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func (l *localDir) Ping(context.Context) error {
	info, err := os.Stat(l.root)
	if err == nil && !info.IsDir() {
		err = fmt.Errorf("%s is not a directory", l.root)
	}
	return err
}

func (l *localDir) String() string {
	return l.root
}
