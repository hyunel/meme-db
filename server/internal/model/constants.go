package model

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
	JobAnalyzeMeme   = "analyze_meme"
	JobResolveLabels = "resolve_labels"
)
