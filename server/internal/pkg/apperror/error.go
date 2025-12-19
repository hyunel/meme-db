package apperror

import (
	"fmt"
	"net/http"
)

type AppError struct {
	Code    int    `json:"-"`
	Message string `json:"error"`
	Err     error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
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
