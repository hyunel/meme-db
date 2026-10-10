package model

// ==============================================================================
// Priority
// ==============================================================================

const (
	PriorityHigh   = 20
	PriorityNormal = 10
	PriorityLow    = 5
)

// ==============================================================================
// Processing Status (for MemeInfo)
// ==============================================================================

const (
	ProcessingStatusPending    = "pending"
	ProcessingStatusProcessing = "processing"
	ProcessingStatusSuccess    = "success"
	ProcessingStatusFailed     = "failed"
)

// ==============================================================================
// Users
// ==============================================================================

const (
	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

// ==============================================================================
// Node Types and Visibility
// ==============================================================================

type NodeType string

const (
	NodeTypeFolder NodeType = "FOLDER"
	NodeTypeFile   NodeType = "FILE"
)

// Effective visibility of a node: its own flag, or inherited from a public ancestor folder.
const (
	VisibilityPrivate   = "private"
	VisibilityPublic    = "public"
	VisibilityInherited = "inherited"
)

// ==============================================================================
// Task Status
// ==============================================================================

const (
	TaskStatusPending   = "pending"
	TaskStatusRunning   = "running"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
)

// ==============================================================================
// Job Types
// ==============================================================================

const (
	JobAnalyzeMeme = "analyze_meme"
)
