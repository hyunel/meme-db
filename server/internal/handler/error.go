package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

// HTTPErrorHandler renders errors as JSON; only AppError and echo.HTTPError messages reach clients.
func HTTPErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}

	appErr := apperror.New(http.StatusInternalServerError, "internal", "internal server error, please try again later", nil)
	var ae *apperror.AppError
	var he *echo.HTTPError
	switch {
	case errors.As(err, &ae):
		appErr = ae
	case errors.As(err, &he):
		text := http.StatusText(he.Code) // "Not Found" -> not_found
		appErr = apperror.New(he.Code, strings.ToLower(strings.ReplaceAll(text, " ", "_")), text, nil)
		if msg, ok := he.Message.(string); ok {
			appErr.Message = msg
		}
	}

	if c.Request().Method == http.MethodHead {
		_ = c.NoContent(appErr.Status)
	} else {
		_ = c.JSON(appErr.Status, appErr)
	}
}
