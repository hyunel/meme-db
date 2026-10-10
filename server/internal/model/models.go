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
	ID          string    `json:"id" db:"id"`
	FileHash    string    `json:"-" db:"file_hash"`
	FileSize    int64     `json:"file_size" db:"file_size"`
	MimeType    string    `json:"mime_type" db:"mime_type"`
	Extension   string    `json:"extension" db:"extension"`
	StoragePath string    `json:"-" db:"storage_path"`
	UploadedBy  *string   `json:"-" db:"uploaded_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type MemeInfo struct {
	AssetID          string           `db:"asset_id"`
	VLMJSON          json.RawMessage  `db:"vlm_json"`
	OCRText          *string          `db:"ocr_text"`
	MetaphorVector   *pgvector.Vector `db:"metaphor_vector"`
	SemanticVector   *pgvector.Vector `db:"semantic_vector"`
	ClipVector       *pgvector.Vector `db:"clip_vector"`
	Width            int              `db:"width"`
	Height           int              `db:"height"`
	ProcessingStatus string           `db:"processing_status"`
	AnalyzedAt       *time.Time       `db:"analyzed_at"`
}

type User struct {
	ID           string    `json:"id" db:"id"`
	Username     string    `json:"username" db:"username"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"`
	Role         string    `json:"role" db:"role"`
	Status       string    `json:"status" db:"status"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type Node struct {
	ID        string    `db:"id"`
	OwnerID   string    `db:"owner_id"`
	ParentID  *string   `db:"parent_id"`
	Path      string    `db:"path"` // ltree text representation
	Name      string    `db:"name"`
	Type      NodeType  `db:"type"`
	IsPublic  bool      `db:"is_public"`
	AssetID   *string   `db:"asset_id"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type Tag struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type TagUsage struct {
	Tag
	Usage int `json:"usage" db:"usage"`
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

	History []TaskAttempt `json:"history" db:"history"` // Finished attempts, oldest first
}

// TaskAttempt records the outcome of one attempt of a task.
type TaskAttempt struct {
	At    time.Time `json:"at"`
	OK    bool      `json:"ok"`
	Error *string   `json:"error"`
}

// ==============================================================================
// Views (DTOs)
// ==============================================================================

// TaskTypeCounts counts the tasks of one job type by state.
type TaskTypeCounts struct {
	JobType          string `json:"job_type" db:"job_type"`
	Pending          int    `json:"pending" db:"pending"`
	Retrying         int    `json:"retrying" db:"retrying"`
	Running          int    `json:"running" db:"running"`
	Completed        int    `json:"completed" db:"completed"`
	Failed           int    `json:"failed" db:"failed"`
	CompletedInRange int    `json:"completed_in_range" db:"completed_in_range"`
	FailedInRange    int    `json:"failed_in_range" db:"failed_in_range"`
}

// Meme is an asset with its analysis, resolved for the requesting viewer.
type Meme struct {
	ID            string     `json:"id"`
	URL           string     `json:"url"`
	MimeType      string     `json:"mime_type"`
	FileSize      int64      `json:"file_size"`
	Width         int        `json:"width"`
	Height        int        `json:"height"`
	Status        string     `json:"status"`
	FailReason    *string    `json:"fail_reason"`
	OCRText       string     `json:"ocr_text"`
	Keywords      []string   `json:"keywords"`
	Tags          []MemeTag  `json:"tags"` // System tags and the viewer's own tags
	IsPublic      bool       `json:"is_public"`
	FavoriteCount int        `json:"favorite_count"`
	LibraryCount  int        `json:"library_count"`
	IsFavorite    bool       `json:"is_favorite"`
	Entry         *EntryRef  `json:"entry"` // The viewer's oldest library entry of this meme
	CreatedAt     time.Time  `json:"created_at"`
	AnalyzedAt    *time.Time `json:"analyzed_at"`
}

type MemeTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mine bool   `json:"mine"`
}

type EntryRef struct {
	ID       string  `json:"id"`
	FolderID *string `json:"folder_id"`
}

type MemeThumb struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	MimeType string `json:"mime_type"`
}

type UserRef struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type PublicUser struct {
	UserRef
	CreatedAt time.Time `json:"created_at"`
}

// Folder is a library folder with its effective visibility and summary.
type Folder struct {
	ID            string      `json:"id"`
	ParentID      *string     `json:"parent_id"`
	Name          string      `json:"name"`
	Visibility    string      `json:"visibility"`
	Owner         UserRef     `json:"owner"`
	ItemCount     int         `json:"item_count"` // Files in the whole subtree
	Previews      []MemeThumb `json:"previews"`   // First analyzed files in the subtree
	FavoriteCount int         `json:"favorite_count"`
	IsFavorite    bool        `json:"is_favorite"`
	CreatedAt     time.Time   `json:"created_at"`
}

// Entry is a file in a user's library.
type Entry struct {
	ID         string    `json:"id"`
	ParentID   *string   `json:"parent_id"`
	Name       string    `json:"name"`
	Visibility string    `json:"visibility"`
	Meme       *Meme     `json:"meme"`
	CreatedAt  time.Time `json:"created_at"`
}

type Crumb struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type UserStats struct {
	Files     int `json:"files" db:"files"`
	Folders   int `json:"folders" db:"folders"`
	Favorites int `json:"favorites" db:"favorites"`
}

type AdminUser struct {
	User
	UserStats
}

type SearchResult struct {
	Meme       *Meme   `json:"meme"`
	RecallType string  `json:"recall_type"`
	Score      float32 `json:"score"`
	Similarity float32 `json:"similarity"`
}

// SearchCandidate is the intermediate result from DB recall.
type SearchCandidate struct {
	AssetID    string          `db:"asset_id"`
	VLMJSON    json.RawMessage `db:"vlm_json"`
	Similarity float32         `db:"similarity"`
	RecallType string          `db:"recall_type"`
}

// Overview is the admin dashboard summary.
type Overview struct {
	Users struct {
		Total  int `json:"total"`
		Admins int `json:"admins"`
		New    int `json:"new"`
	} `json:"users"`
	Memes struct {
		Total        int   `json:"total"`
		StorageBytes int64 `json:"storage_bytes"`
		Public       int   `json:"public"`
		Analyzed     int   `json:"analyzed"`
		Pending      int   `json:"pending"`
		Failed       int   `json:"failed"`
	} `json:"memes"`
	Library struct {
		Folders     int `json:"folders"`
		Files       int `json:"files"`
		PublicNodes int `json:"public_nodes"`
		Tags        int `json:"tags"`
	} `json:"library"`
	Tasks    []*TaskTypeCounts `json:"tasks"`
	Trend    []*TrendPoint     `json:"trend"`
	Services []ServiceStatus   `json:"services"`
}

type TrendPoint struct {
	Day       string `json:"day" db:"day"`
	Uploads   int    `json:"uploads" db:"uploads"`
	Users     int    `json:"users" db:"users"`
	Completed int    `json:"completed" db:"completed"`
	Failed    int    `json:"failed" db:"failed"`
}

type ServiceStatus struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// LogEntry is a stored service log record.
type LogEntry struct {
	ID      int64             `json:"id" db:"id"`
	Time    time.Time         `json:"time" db:"time"`
	Level   string            `json:"level" db:"level"`
	Message string            `json:"message" db:"message"`
	Attrs   map[string]string `json:"attrs" db:"attrs"`
}

// Page is one page of a filtered list.
type Page[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}
