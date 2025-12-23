package config

import (
	"log/slog"
	"os"

	"github.com/goccy/go-yaml"
)

type Config struct {
	Server    ServerConfig    `yaml:"server"`
	Database  DatabaseConfig  `yaml:"database"`
	Inference InferenceConfig `yaml:"inference"`
	VLM       VLMConfig       `yaml:"vlm"`
	Prompt    PromptConfig    `yaml:"prompt"`
}

type PromptConfig struct {
	Caption   string `yaml:"caption"`
	Retrieval string `yaml:"retrieval"`
}

type ServerConfig struct {
	Port        int    `yaml:"port"`
	JWTSecret   string `yaml:"jwt_secret"`
	StoragePath string `yaml:"storage_path"`
}

type DatabaseConfig struct {
	URL string `yaml:"url"`
}

type InferenceConfig struct {
	GRPCAddr string      `yaml:"grpc_addr"`
	Batch    BatchConfig `yaml:"batch"`
}

type BatchConfig struct {
	TextEmbedding int `yaml:"text_embedding"`
	ClipEmbedding int `yaml:"clip_embedding"`
	Rerank        int `yaml:"rerank"`
	ImageCaption  int `yaml:"image_caption"`
}

type VLMConfig struct {
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"api_key"`
	Model   string `yaml:"model"`
}

func LoadConfig(path string) *Config {
	f, err := os.Open(path)
	if err != nil {
		slog.Error("Failed to open config file", "error", err)
		os.Exit(1)
	}
	defer f.Close()

	var cfg Config
	decoder := yaml.NewDecoder(f)
	if err := decoder.Decode(&cfg); err != nil {
		slog.Error("Failed to decode config file", "error", err)
		os.Exit(1)
	}

	return &cfg
}
