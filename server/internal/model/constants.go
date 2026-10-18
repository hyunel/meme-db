package model

import "time"

const (
	PriorityHigh   = 20
	PriorityNormal = 10
	PriorityLow    = 5
)

const (
	ProcessingStatusPending    = "pending"
	ProcessingStatusProcessing = "processing"
	ProcessingStatusSuccess    = "success"
	ProcessingStatusFailed     = "failed"
)

const (
	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

type NodeType string

const (
	NodeTypeFolder NodeType = "FOLDER"
	NodeTypeFile   NodeType = "FILE"
)

const (
	VisibilityPrivate   = "private"
	VisibilityPublic    = "public"
	VisibilityInherited = "inherited"
)

const (
	TaskStatusPending   = "pending"
	TaskStatusRunning   = "running"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
)

const (
	JobAnalyzeMeme = "analyze_meme"
	JobEmbedClip   = "embed_clip"   // Rebuilds a meme's CLIP embedding
	JobEmbedText   = "embed_text"   // Rebuilds a meme's text embeddings from its VLM output
	JobRefreshTags = "refresh_tags" // Recounts the tags' usage and finds those suggested as duplicates
	JobPurgeLogs   = "purge_logs"   // Deletes the stored logs older than its retention
	JobPurgeTasks  = "purge_tasks"  // Deletes the finished tasks older than its retention
)

type JobPolicy struct {
	Timeout     time.Duration // Of an attempt; the claim's lease lasts twice this
	MaxAttempts int
}

// JobPolicies are stored on each task as it is enqueued.
var JobPolicies = map[string]JobPolicy{
	JobAnalyzeMeme: {Timeout: 5 * time.Minute, MaxAttempts: 3}, // The VLM may be a slow, flaky remote API
	JobEmbedClip:   {Timeout: time.Minute, MaxAttempts: 3},
	JobEmbedText:   {Timeout: time.Minute, MaxAttempts: 3},
	JobRefreshTags: {Timeout: 5 * time.Minute, MaxAttempts: 3},
	JobPurgeLogs:   {Timeout: 5 * time.Minute, MaxAttempts: 3},
	JobPurgeTasks:  {Timeout: 5 * time.Minute, MaxAttempts: 3},
}
