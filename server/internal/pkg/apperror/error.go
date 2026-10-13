package apperror

import (
	"fmt"
	"net/http"
)

// AppError is an error clients see. Messages are English; clients word errors in their own language by Code.
type AppError struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"` // Stable, snake_case
	Message string         `json:"error"`
	Field   string         `json:"field,omitempty"`  // The request field the error is about, if any
	Params  map[string]any `json:"params,omitempty"` // Values the message mentions
	Err     error          `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) OnField(field string) *AppError {
	e.Field = field
	return e
}

func (e *AppError) With(key string, value any) *AppError {
	if e.Params == nil {
		e.Params = make(map[string]any)
	}
	e.Params[key] = value
	return e
}

func New(status int, code, message string, err error) *AppError {
	return &AppError{
		Status:  status,
		Code:    code,
		Message: message,
		Err:     err,
	}
}

func BadRequest(code, message string) *AppError {
	return New(http.StatusBadRequest, code, message, nil)
}

func Unauthorized(code, message string) *AppError {
	return New(http.StatusUnauthorized, code, message, nil)
}

func Forbidden(code, message string) *AppError {
	return New(http.StatusForbidden, code, message, nil)
}

func NotFound(code, message string) *AppError {
	return New(http.StatusNotFound, code, message, nil)
}

func Conflict(code, message string) *AppError {
	return New(http.StatusConflict, code, message, nil)
}
