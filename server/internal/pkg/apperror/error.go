package apperror

import (
	"fmt"
	"net/http"
)

// AppError is an expected error whose message is shown to the user.
type AppError struct {
	Code    int    `json:"-"`
	Message string `json:"error"`
	Field   string `json:"field,omitempty"` // The request field the error is about, if any
	Err     error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

// OnField attributes the error to a request field.
func (e *AppError) OnField(field string) *AppError {
	e.Field = field
	return e
}

func New(code int, message string, err error) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

func BadRequest(message string) *AppError {
	return New(http.StatusBadRequest, message, nil)
}

func Unauthorized(message string) *AppError {
	return New(http.StatusUnauthorized, message, nil)
}

func Forbidden(message string) *AppError {
	return New(http.StatusForbidden, message, nil)
}

func NotFound(message string) *AppError {
	return New(http.StatusNotFound, message, nil)
}

func Conflict(message string) *AppError {
	return New(http.StatusConflict, message, nil)
}
