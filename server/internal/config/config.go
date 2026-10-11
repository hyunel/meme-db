package config

import (
	_ "embed"
	"fmt"
	"os"
	"regexp"
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
	Log       LogConfig       `yaml:"log" validate:"required"`
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

type LogConfig struct {
	Retention time.Duration `yaml:"retention" validate:"required,gt=0"`
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

var envPlaceholder = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

func LoadConfig(path string) (*Config, error) {
	var cfg Config

	if err := yaml.Unmarshal(defaultConfig, &cfg); err != nil {
		return nil, fmt.Errorf("failed to decode default config: %w", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	// ${VAR} placeholders come from the environment; unset ones are kept.
	data = envPlaceholder.ReplaceAllFunc(data, func(m []byte) []byte {
		if v, ok := os.LookupEnv(string(m[2 : len(m)-1])); ok {
			return []byte(v)
		}
		return m
	})

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to decode config file: %w", err)
	}

	v := validator.New()
	if err := v.Validate(&cfg); err != nil {
		return nil, fmt.Errorf("failed to validate config: %w", err)
	}

	return &cfg, nil
}
