package model

import (
	"encoding/json"
	"time"

	"github.com/pgvector/pgvector-go"
)

// ==============================================================================
// Domain Entities
// ==============================================================================

type Asset struct {
	ID             string    `json:"id" db:"id"`
	FileHash       string    `json:"-" db:"file_hash"`
	FileSize       int64     `json:"file_size" db:"file_size"`
	MimeType       string    `json:"mime_type" db:"mime_type"`
	Extension      string    `json:"extension" db:"extension"`
	StoragePath    string    `json:"-" db:"storage_path"`
	RefCount       int       `json:"-" db:"ref_count"`
	PublicRefCount int       `json:"-" db:"public_ref_count"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

type MemeInfo struct {
	AssetID          string           `json:"-" db:"asset_id"`
	VLMJSON          json.RawMessage  `json:"-" db:"vlm_json"`
	OCRText          *string          `json:"-" db:"ocr_text"`
	MetaphorVector   *pgvector.Vector `json:"-" db:"metaphor_vector"`
	SemanticVector   *pgvector.Vector `json:"-" db:"semantic_vector"`
	ClipVector       *pgvector.Vector `json:"-" db:"clip_vector"`
	Width            int              `json:"width" db:"width"`
	Height           int              `json:"height" db:"height"`
	ProcessingStatus string           `json:"processing_status" db:"processing_status"`
	AnalyzedAt       *time.Time       `json:"analyzed_at" db:"analyzed_at"`
}

type User struct {
	ID           string    `json:"id" db:"id"`
	Username     string    `json:"username" db:"username"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"`
	Role         string    `json:"role" db:"role"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type Node struct {
	ID          string     `json:"id" db:"id"`
	OwnerID     string     `json:"owner_id" db:"owner_id"`
	ParentID    *string    `json:"parent_id" db:"parent_id"`
	Path        string     `json:"-" db:"path"` // ltree text representation
	Name        string     `json:"name" db:"name"`
	Type        NodeType   `json:"type" db:"type"`
	Visibility  Visibility `json:"visibility" db:"visibility"`
	AssetID     *string    `json:"-" db:"asset_id"`
	PrivateNote *string    `json:"-" db:"private_note"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

type Tag struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Type      string    `json:"type" db:"type"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type Task struct {
	ID           string          `json:"id" db:"id"`
	OwnerID      *string         `json:"owner_id" db:"owner_id"`
	ParentTaskID *string         `json:"parent_task_id" db:"parent_task_id"`
	JobType      string          `json:"job_type" db:"job_type"`
	Payload      json.RawMessage `json:"payload" db:"payload"`
	Status       string          `json:"status" db:"status"`
	ErrorMessage *string         `json:"error_message" db:"error_message"`

	Priority   int        `json:"priority" db:"priority"`
	Cron       *string    `json:"cron" db:"cron"`
	Attempts   int        `json:"attempts" db:"attempts"`
	RunAt      time.Time  `json:"run_at" db:"run_at"`
	StartedAt  *time.Time `json:"started_at" db:"started_at"`
	FinishedAt *time.Time `json:"finished_at" db:"finished_at"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// ==============================================================================
// Aggregated Views (DTOs)
// ==============================================================================

// NodeView combines Node + MemeView
type NodeView struct {
	*Node
	Meme       *MemeView `json:"meme"`
	IsFavorite bool      `json:"is_favorite" db:"is_favorite"` // Computed field
}

// MemeView flattened view of Asset and MemeInfo
type MemeView struct {
	AssetID   string `json:"asset_id"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	FileSize  int64  `json:"file_size"`
	MimeType  string `json:"mime_type"`
	Extension string `json:"extension"`

	ProcessingStatus string `json:"processing_status"`
	InLibrary        bool   `json:"in_library"`
	IsFavorite       bool   `json:"is_favorite"`
	Tags             []*Tag `json:"tags"`
	URL              string `json:"url"`

	CreatedAt  time.Time  `json:"created_at"`
	AnalyzedAt *time.Time `json:"analyzed_at"`
}

type SearchResult struct {
	Meme       *MemeView `json:"meme"`
	RecallType string    `json:"recall_type"`
	Score      float32   `json:"score"`
	Similarity float32   `json:"similarity"`
}

// SearchCandidate is the intermediate result from DB search
type SearchCandidate struct {
	MemeInfo
	Similarity float32 `db:"similarity"`
	RecallType string  `db:"recall_type"`
}
