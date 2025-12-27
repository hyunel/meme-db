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
	MemeProcessingTimeout = 30 // minutes
)
