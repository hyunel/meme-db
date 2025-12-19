package handler

import (
	"net/http"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

func HTTPErrorHandler(err error, c echo.Context) {
	code := http.StatusInternalServerError
	var msg string = "internal server error"

	if he, ok := err.(*echo.HTTPError); ok {
		code = he.Code
		msg = fmtMsg(he.Message)
	} else if ae, ok := err.(*apperror.AppError); ok {
		code = ae.Code
		msg = ae.Message
	}

	// Send response
	if !c.Response().Committed {
		if c.Request().Method == http.MethodHead {
			err = c.NoContent(code)
		} else {
			err = c.String(code, msg)
		}
	}
}

func fmtMsg(msg interface{}) string {
	if s, ok := msg.(string); ok {
		return s
	}
	return "unknown error"
}
