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
	"os"
	"path/filepath"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/repository"
)

type AssetService struct {
	cfg  *config.Config
	repo *repository.Provider
}

func NewAssetService(cfg *config.Config, repo *repository.Provider) *AssetService {
	return &AssetService{cfg: cfg, repo: repo}
}

func (s *AssetService) CreateAsset(ctx context.Context, fileHeader *multipart.FileHeader) (*model.Asset, error) {
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
			MimeType:    fileHeader.Header.Get("Content-Type"),
			Extension:   ext,
			StoragePath: relPath,
		}
		if err := r.Asset.CreateAsset(ctx, asset); err != nil {
			return err
		}

		// b. Create MemeInfo Stub
		memeInfo := &model.MemeInfo{
			AssetID: asset.ID,
		}
		if err := r.Meme.CreateMeme(ctx, memeInfo); err != nil {
			return fmt.Errorf("failed to create meme info stub: %w", err)
		}

		// c. Trigger Processing Task
		_, err = r.Task.CreateTaskWithOpts(ctx, model.JobProcessMemes, map[string]string{
			"start_id": asset.ID,
		}, &repository.TaskOpts{Priority: 10})
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
