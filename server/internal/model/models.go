package model

import (
	"encoding/json"
	"time"

	"github.com/pgvector/pgvector-go"
)

type Asset struct {
	ID             string    `json:"id" db:"id"`
	FileHash       string    `json:"file_hash" db:"file_hash"`
	FileSize       int64     `json:"file_size" db:"file_size"`
	MimeType       string    `json:"mime_type" db:"mime_type"`
	Extension      string    `json:"extension" db:"extension"`
	StoragePath    string    `json:"storage_path" db:"storage_path"`
	RefCount       int       `json:"ref_count" db:"ref_count"`
	PublicRefCount int       `json:"public_ref_count" db:"public_ref_count"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

type MemeInfo struct {
	AssetID        string           `json:"asset_id" db:"asset_id"`
	VLMJSON        json.RawMessage  `json:"vlm_json" db:"vlm_json"`
	OCRText        *string          `json:"ocr_text" db:"ocr_text"`
	MetaphorVector *pgvector.Vector `json:"-" db:"metaphor_vector"`
	SemanticVector *pgvector.Vector `json:"-" db:"semantic_vector"`
	ClipVector     *pgvector.Vector `json:"-" db:"clip_vector"`
	Width          int              `json:"width" db:"width"`
	Height         int              `json:"height" db:"height"`
	AnalyzedAt     *time.Time       `json:"analyzed_at" db:"analyzed_at"`
}

type User struct {
	ID           string    `json:"id" db:"id"`
	Username     string    `json:"username" db:"username"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type NodeType string
type Visibility string

const (
	NodeTypeFolder NodeType   = "FOLDER"
	NodeTypeFile   NodeType   = "FILE"
	VisibilityPriv Visibility = "PRIVATE"
	VisibilityPub  Visibility = "PUBLIC"
)

type Node struct {
	ID          string     `json:"id" db:"id"`
	OwnerID     string     `json:"owner_id" db:"owner_id"`
	ParentID    *string    `json:"parent_id" db:"parent_id"`
	Path        string     `json:"path" db:"path"` // ltree text representation
	Name        string     `json:"name" db:"name"`
	Type        NodeType   `json:"type" db:"type"`
	Visibility  Visibility `json:"visibility" db:"visibility"`
	AssetID     *string    `json:"asset_id" db:"asset_id"`
	URL         string     `json:"url"`
	IsFavorite  bool       `json:"is_favorite" db:"is_favorite"`
	PrivateNote *string    `json:"private_note" db:"private_note"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

type Tag struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type MemeDTO struct {
	AssetID          string     `json:"asset_id"`
	Width            int        `json:"width"`
	Height           int        `json:"height"`
	Tags             []*Tag     `json:"tags"`
	URL              *string    `json:"url"`
	InLibrary        bool       `json:"in_library"`
	AnalyzedAt       *time.Time `json:"analyzed_at"`
	ProcessingStatus string     `json:"processing_status"`
}

type SearchResult struct {
	Meme       *MemeDTO `json:"meme"`
	RecallType string   `json:"recall_type"`
	Score      float32  `json:"score"`
	Similarity float32  `json:"similarity"`
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
	RunAt      time.Time  `json:"run_at" db:"run_at"`
	StartedAt  *time.Time `json:"started_at" db:"started_at"`
	FinishedAt *time.Time `json:"finished_at" db:"finished_at"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

const (
	TaskStatusPending   = "pending"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
)

const (
	JobProcessMemes = "process_memes"
)
