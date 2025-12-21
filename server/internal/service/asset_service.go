package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"github.com/hyunel/MemeDB/internal/config"
)

type AssetService struct {
	cfg *config.Config
}

func NewAssetService(cfg *config.Config) *AssetService {
	return &AssetService{cfg: cfg}
}

func (s *AssetService) GenerateAccessToken(assetID string) (string, error) {
	h := hmac.New(sha256.New, []byte(s.cfg.Server.JWTSecret))
	h.Write([]byte(assetID))
	fullSignature := h.Sum(nil)

	// Take first 8 bytes and encode
	signature := base64.RawURLEncoding.EncodeToString(fullSignature[:8])

	return signature, nil
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
