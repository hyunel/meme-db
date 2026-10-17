package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type AssetServiceConfig struct {
	StoragePath  string
	Secret       string // Signs file links
	MaxSizeMB    float64
	AllowedTypes []string
}

type AssetService struct {
	cfg      AssetServiceConfig
	repo     *repository.Provider
	notifier Notifier
}

func NewAssetService(cfg AssetServiceConfig, repo *repository.Provider, notifier Notifier) *AssetService {
	return &AssetService{cfg: cfg, repo: repo, notifier: notifier}
}

type UploadConfig struct {
	MaxSizeMB float64 `json:"max_size_mb"`
	Accept    string  `json:"accept"` // For <input type="file" accept>
}

func (s *AssetService) UploadConfig() UploadConfig {
	var accept []string
	for _, rule := range s.cfg.AllowedTypes {
		parts := strings.Split(rule, ",")
		if len(parts) > 1 {
			parts = parts[1:] // Extensions are the narrower filter
		}
		for _, p := range parts {
			accept = append(accept, strings.TrimSpace(p))
		}
	}
	return UploadConfig{MaxSizeMB: s.cfg.MaxSizeMB, Accept: strings.Join(accept, ",")}
}

func (s *AssetService) ValidateUpload(fileHeader *multipart.FileHeader) (string, error) {
	if fileHeader.Size > int64(s.cfg.MaxSizeMB*1024*1024) {
		return "", apperror.BadRequest("file_too_large", fmt.Sprintf("the file exceeds the %g MB limit", s.cfg.MaxSizeMB)).With("max_mb", s.cfg.MaxSizeMB)
	}

	file, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open file for validation: %w", err)
	}
	defer file.Close()

	head := make([]byte, 512)
	n, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", fmt.Errorf("failed to read file header: %w", err)
	}
	mime := detectMIME(head[:n])
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))

	if !slices.ContainsFunc(s.cfg.AllowedTypes, func(rule string) bool { return matchesType(rule, mime, ext) }) {
		return "", apperror.BadRequest("unsupported_file_type", "unsupported file type: "+mime).With("type", mime)
	}
	return mime, nil
}

func detectMIME(head []byte) string {
	mime, _, _ := strings.Cut(http.DetectContentType(head), ";")
	// DetectContentType has no JSON signature (Lottie animations are JSON).
	if trimmed := bytes.TrimSpace(head); mime == "text/plain" && len(trimmed) > 0 && trimmed[0] == '{' {
		return "application/json"
	}
	return mime
}

// A rule is "mime/pattern[,.ext...]"; listed extensions further restrict the file name.
func matchesType(rule, mime, ext string) bool {
	parts := strings.Split(rule, ",")
	pattern := strings.TrimSpace(parts[0])
	if prefix, ok := strings.CutSuffix(pattern, "*"); ok {
		if !strings.HasPrefix(mime, prefix) {
			return false
		}
	} else if mime != pattern {
		return false
	}
	return len(parts) == 1 || slices.ContainsFunc(parts[1:], func(e string) bool {
		return strings.ToLower(strings.TrimSpace(e)) == ext
	})
}

// CreateAsset stores a file and queues new content for analysis, which uses caption as the VLM's output when given.
func (s *AssetService) CreateAsset(ctx context.Context, uploaderID string, fileHeader *multipart.FileHeader, caption string) (*model.Asset, error) {
	mimeType, err := s.ValidateUpload(fileHeader)
	if err != nil {
		return nil, err
	}

	src, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer src.Close()

	if err := os.MkdirAll(s.cfg.StoragePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}
	tmp, err := os.CreateTemp(s.cfg.StoragePath, "upload-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmp.Name()) // No-op once renamed into place

	hasher := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hasher), src)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	if existing, err := s.repo.Asset.GetByHash(ctx, hash); err != nil || existing != nil {
		return existing, err
	}

	// Files are content-addressed, so replacing a concurrent upload of the same content is harmless.
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	relPath := filepath.Join(hash[:2], hash[2:4], hash[4:]+ext)
	absPath := filepath.Join(s.cfg.StoragePath, relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}
	if err := os.Rename(tmp.Name(), absPath); err != nil {
		return nil, fmt.Errorf("failed to store file: %w", err)
	}

	var asset *model.Asset
	created := false
	err = s.repo.Tx(ctx, func(r *repository.Repos) error {
		asset, created, err = r.Asset.Create(ctx, &model.Asset{
			FileHash:    hash,
			FileSize:    size,
			MimeType:    mimeType,
			Extension:   ext,
			StoragePath: relPath,
			UploadedBy:  &uploaderID,
		})
		if err != nil || !created {
			return err
		}
		if err := r.Meme.Create(ctx, &model.MemeInfo{AssetID: asset.ID, ProcessingStatus: model.ProcessingStatusPending}); err != nil {
			return fmt.Errorf("failed to create meme info stub: %w", err)
		}
		payload := MemePayload{AssetID: asset.ID, Caption: caption}
		if err := r.Task.Enqueue(ctx, model.JobAnalyzeMeme, []any{payload}, repository.TaskOpts{Priority: model.PriorityHigh}); err != nil {
			return fmt.Errorf("failed to enqueue analysis: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if created {
		s.notifier.Notify()
	}
	return asset, nil
}

func (s *AssetService) RemoveFiles(paths []string) {
	for _, p := range paths {
		if err := os.Remove(filepath.Join(s.cfg.StoragePath, p)); err != nil && !os.IsNotExist(err) {
			slog.Error("Failed to remove asset file", "path", p, "error", err)
		}
	}
}

func (s *AssetService) URL(assetID string) string {
	return fmt.Sprintf("/api/assets/%s?token=%s", assetID, s.sign(assetID))
}

func (s *AssetService) sign(assetID string) string {
	h := hmac.New(sha256.New, []byte(s.cfg.Secret))
	h.Write([]byte(assetID))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:8])
}

func (s *AssetService) Content(ctx context.Context, assetID, token string) (*model.Asset, string, error) {
	if !hmac.Equal([]byte(token), []byte(s.sign(assetID))) {
		return nil, "", apperror.Unauthorized("invalid_asset_token", "invalid file access token")
	}
	asset, err := s.repo.Asset.Get(ctx, assetID)
	if err != nil {
		return nil, "", err
	}
	if asset == nil {
		return nil, "", apperror.NotFound("file_not_found", "file not found")
	}
	return asset, filepath.Join(s.cfg.StoragePath, asset.StoragePath), nil
}

func (s *AssetService) signMemes(memes []*model.Meme) {
	for _, m := range memes {
		m.URL = s.URL(m.ID)
	}
}

func (s *AssetService) signFolders(folders []*model.Folder) {
	for _, f := range folders {
		for i := range f.Previews {
			f.Previews[i].URL = s.URL(f.Previews[i].ID)
		}
	}
}
