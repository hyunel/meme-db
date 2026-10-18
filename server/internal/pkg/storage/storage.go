package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/hyunel/MemeDB/internal/config"
)

// Storage keeps files under slash-separated keys.
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error) // A missing key wraps fs.ErrNotExist
	Delete(ctx context.Context, key string) error                    // A missing key is no error
	Ping(ctx context.Context) error
	fmt.Stringer // Where the files are, for the admin console
}

func New(cfg config.StorageConfig) Storage {
	if cfg.Backend == "s3" {
		return newS3Bucket(*cfg.S3)
	}
	return &localDir{root: cfg.Local.Path}
}
