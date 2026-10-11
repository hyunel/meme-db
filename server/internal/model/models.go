package model

import (
	"encoding/json"
	"time"

	"github.com/pgvector/pgvector-go"
)

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

type APIToken struct {
	ID         string     `json:"id" db:"id"`
	UserID     string     `json:"-" db:"user_id"`
	Name       string     `json:"name" db:"name"`
	Hint       string     `json:"hint" db:"hint"` // Last characters of the secret
	Scope      string     `json:"scope" db:"scope"`
	ExpiresAt  *time.Time `json:"expires_at" db:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at" db:"last_used_at"` // Recorded to the minute
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
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

type TagUsage struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Aliases   []string  `json:"aliases" db:"aliases"` // Other spellings that resolve to this tag
	Hidden    bool      `json:"hidden" db:"hidden"`
	Common    bool      `json:"common" db:"common"` // On so many memes that it hardly tells them apart
	Usage     int       `json:"usage" db:"usage"`
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

	History []TaskAttempt `json:"history" db:"history"` // Finished attempts, oldest first
}

type TaskAttempt struct {
	At    time.Time `json:"at"`
	OK    bool      `json:"ok"`
	Error *string   `json:"error"`
}

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
	Title         string     `json:"title"`
	Summary       string     `json:"summary"`
	Tags          []MemeTag  `json:"tags"` // System tags and the viewer's own tags
	IsPublic      bool       `json:"is_public"`
	FavoriteCount int        `json:"favorite_count"`
	LibraryCount  int        `json:"library_count"`
	IsFavorite    bool       `json:"is_favorite"`
	Entries       []EntryRef `json:"entries"` // The viewer's library entries of this meme, oldest first
	CreatedAt     time.Time  `json:"created_at"`
	AnalyzedAt    *time.Time `json:"analyzed_at"`
}

type MemeTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mine bool   `json:"mine"`
	Rare bool   `json:"rare"` // On too few memes to show on cards
}

type EntryRef struct {
	ID       string  `json:"id"`
	FolderID *string `json:"folder_id"`
}

type FolderRef struct {
	ID       string  `json:"id" db:"id"`
	ParentID *string `json:"parent_id" db:"parent_id"`
	Name     string  `json:"name" db:"name"`
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

type SearchCandidate struct {
	AssetID    string          `db:"asset_id"`
	VLMJSON    json.RawMessage `db:"vlm_json"`
	Similarity float32         `db:"similarity"`
	RecallType string          `db:"recall_type"`
}

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

type LogEntry struct {
	ID      int64             `json:"id" db:"id"`
	Time    time.Time         `json:"time" db:"time"`
	Level   string            `json:"level" db:"level"`
	Message string            `json:"message" db:"message"`
	Attrs   map[string]string `json:"attrs" db:"attrs"`
}

type Page[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}
