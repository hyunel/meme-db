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
// Node Types and Visibility
// ==============================================================================

type NodeType string
type Visibility string

const (
	NodeTypeFolder NodeType = "FOLDER"
	NodeTypeFile   NodeType = "FILE"
)

const (
	VisibilityPrivate Visibility = "PRIVATE"
	VisibilityPublic  Visibility = "PUBLIC"
	VisibilityLink    Visibility = "LINK"
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
