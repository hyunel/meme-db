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
)

type JobPolicy struct {
	Timeout     time.Duration // Of an attempt; the claim's lease lasts twice this
	MaxAttempts int
}

// JobPolicies are stored on each task as it is enqueued.
var JobPolicies = map[string]JobPolicy{
	JobAnalyzeMeme: {Timeout: 5 * time.Minute, MaxAttempts: 3}, // The VLM may be a slow, flaky remote API
}
