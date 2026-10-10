package config

import (
	_ "embed"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/goccy/go-yaml"
	"github.com/hyunel/MemeDB/internal/pkg/validator"
)

//go:embed default.yaml
var defaultConfig []byte

type Config struct {
	Server    ServerConfig    `yaml:"server" validate:"required"`
	Database  DatabaseConfig  `yaml:"database" validate:"required"`
	Inference InferenceConfig `yaml:"inference" validate:"required"`
	Worker    WorkerConfig    `yaml:"worker" validate:"required"`
	VLM       VLMConfig       `yaml:"vlm"`
	Prompt    PromptConfig    `yaml:"prompt" validate:"required"`
	Upload    UploadConfig    `yaml:"upload" validate:"required"`
}

type UploadConfig struct {
	MaxSizeMB    float64  `yaml:"max_size_mb" validate:"required,gt=0"`
	AllowedTypes []string `yaml:"allowed_types" validate:"required,min=1"`
}

type PromptConfig struct {
	Caption   string `yaml:"caption" validate:"required"`
	Retrieval string `yaml:"retrieval" validate:"required"`
}

type ServerConfig struct {
	Port        int    `yaml:"port" validate:"required,gt=0"`
	JWTSecret   string `yaml:"jwt_secret" validate:"required"`
	StoragePath string `yaml:"storage_path" validate:"required"`
}

type DatabaseConfig struct {
	URL string `yaml:"url" validate:"required,url"`
}

type InferenceConfig struct {
	GRPCAddr string `yaml:"grpc_addr" validate:"required"`
}

type WorkerConfig struct {
	Concurrency  int           `yaml:"concurrency" validate:"required,gt=0"`
	MaxAttempts  int           `yaml:"max_attempts" validate:"required,gt=0"`
	JobTimeout   time.Duration `yaml:"job_timeout" validate:"required,gt=0"`
	PollInterval time.Duration `yaml:"poll_interval" validate:"required,gt=0"`
}

type VLMConfig struct {
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"api_key"`
	Model   string `yaml:"model"`
}

func LoadConfig(path string) (*Config, error) {
	var cfg Config

	// 1. Load embedded default config
	if err := yaml.Unmarshal(defaultConfig, &cfg); err != nil {
		slog.Error("Failed to unmarshal default config", "error", err)
		os.Exit(1)
	}

	// 2. Load external config file
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open config file: %w", err)
	}
	defer f.Close()

	decoder := yaml.NewDecoder(f)
	if err := decoder.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("failed to decode config file: %w", err)
	}

	// 3. Validate config
	v := validator.New()
	if err := v.Validate(&cfg); err != nil {
		return nil, fmt.Errorf("failed to validate config: %w", err)
	}

	return &cfg, nil
}
