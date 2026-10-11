package handler

import (
	"errors"
	"net/http"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

// HTTPErrorHandler renders errors as JSON; only AppError and echo.HTTPError messages reach clients.
func HTTPErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}

	appErr := apperror.New(http.StatusInternalServerError, "服务器内部错误，请稍后重试", nil)
	var ae *apperror.AppError
	var he *echo.HTTPError
	switch {
	case errors.As(err, &ae):
		appErr = ae
	case errors.As(err, &he):
		appErr = apperror.New(he.Code, http.StatusText(he.Code), nil)
		if msg, ok := he.Message.(string); ok {
			appErr.Message = msg
		}
	}

	if c.Request().Method == http.MethodHead {
		_ = c.NoContent(appErr.Code)
	} else {
		_ = c.JSON(appErr.Code, appErr)
	}
}
