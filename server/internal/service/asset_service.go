package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

type AssetService struct {
	cfg  *config.Config
	repo *repository.Provider
}

func NewAssetService(cfg *config.Config, repo *repository.Provider) *AssetService {
	return &AssetService{cfg: cfg, repo: repo}
}

func (s *AssetService) ValidateUpload(fileHeader *multipart.FileHeader) (string, error) {
	// 1. Check File Size
	maxSizeBytes := int64(s.cfg.Upload.MaxSizeMB * 1024 * 1024)
	if fileHeader.Size > maxSizeBytes {
		return "", apperror.BadRequest(fmt.Sprintf("file too large: %d bytes (max %.1f MB)", fileHeader.Size, s.cfg.Upload.MaxSizeMB))
	}

	// 2. Check File Type
	file, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open file for validation: %w", err)
	}
	defer file.Close()

	// Detect MIME type from content
	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", fmt.Errorf("failed to read file header: %w", err)
	}
	detectedMime := http.DetectContentType(buffer[:n])
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))

	allowed := false
	for _, pattern := range s.cfg.Upload.AllowedTypes {
		parts := strings.Split(pattern, ",")
		if len(parts) == 0 {
			continue
		}

		// MIME type check
		if strings.HasSuffix(parts[0], "/*") {
			prefix := strings.TrimSuffix(parts[0], "*")
			if strings.HasPrefix(detectedMime, prefix) {
				allowed = true
				break
			}
		} else if detectedMime == parts[0] {
			allowed = true
			break
		}

		// Extension check
		for _, extPattern := range parts[1:] {
			extPattern = strings.ToLower(strings.TrimSpace(extPattern))
			if ext != extPattern {
				allowed = false
				break
			}
		}
	}

	if !allowed {
		return "", apperror.BadRequest(fmt.Sprintf("file type not allowed: %s", detectedMime))
	}

	return detectedMime, nil
}

func (s *AssetService) CreateAsset(ctx context.Context, fileHeader *multipart.FileHeader) (*model.Asset, error) {
	mimeType, err := s.ValidateUpload(fileHeader)
	if err != nil {
		return nil, err
	}

	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// 1. Calculate Hash
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return nil, fmt.Errorf("failed to hash file: %w", err)
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	// 2. Check if asset exists
	existing, err := s.repo.Asset.GetAssetByHash(ctx, hash)
	if err != nil {
		return nil, err
	}

	if existing != nil {
		return existing, nil
	}

	// 3. Save file to storage
	file.Seek(0, 0)

	ext := filepath.Ext(fileHeader.Filename)
	relPath := filepath.Join(hash[:2], hash[2:4], hash[4:]+ext)
	absPath := filepath.Join(s.cfg.Server.StoragePath, relPath)

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	dst, err := os.Create(absPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		os.Remove(absPath)
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	var asset *model.Asset
	err = s.repo.Transaction(ctx, func(r *repository.Repositories) error {
		// a. Create Asset Record
		asset = &model.Asset{
			FileHash:    hash,
			FileSize:    fileHeader.Size,
			MimeType:    mimeType,
			Extension:   ext,
			StoragePath: relPath,
		}
		if err := r.Asset.CreateAsset(ctx, asset); err != nil {
			return err
		}

		// b. Create MemeInfo Stub
		memeInfo := &model.MemeInfo{
			AssetID:          asset.ID,
			ProcessingStatus: model.ProcessingStatusPending,
		}
		if err := r.Meme.CreateMeme(ctx, memeInfo); err != nil {
			return fmt.Errorf("failed to create meme info stub: %w", err)
		}

		// c. Trigger Processing Task
		_, err = r.Task.CreateTaskWithOpts(ctx, model.JobProcessMemes, map[string]any{
			"start_id":   asset.ID,
			"batch_size": s.cfg.Inference.BatchSize,
		}, &repository.TaskOpts{Priority: model.PriorityHigh})
		if err != nil {
			return fmt.Errorf("failed to create processing task: %w", err)
		}

		return nil
	})

	if err != nil {
		os.Remove(absPath)
		return nil, err
	}

	return asset, nil
}

func (s *AssetService) GetAssetURL(assetID string) string {
	h := hmac.New(sha256.New, []byte(s.cfg.Server.JWTSecret))
	h.Write([]byte(assetID))
	fullSignature := h.Sum(nil)

	// Take first 8 bytes and encode
	signature := base64.RawURLEncoding.EncodeToString(fullSignature[:8])

	return fmt.Sprintf("/api/assets/%s?token=%s", assetID, signature)
}

func (s *AssetService) VerifyAccessToken(assetID string, token string) error {
	h := hmac.New(sha256.New, []byte(s.cfg.Server.JWTSecret))
	h.Write([]byte(assetID))
	fullSignature := h.Sum(nil)
	expectedSignature := base64.RawURLEncoding.EncodeToString(fullSignature[:8])

	if !hmac.Equal([]byte(token), []byte(expectedSignature)) {
		return fmt.Errorf("invalid signature")
	}

	return nil
}
