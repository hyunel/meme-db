package handler

import (
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/labstack/echo/v4"
)

func BindAndValidate(c echo.Context, req interface{}) error {
	if err := c.Bind(req); err != nil {
		return apperror.BadRequest(err.Error())
	}

	if err := c.Validate(req); err != nil {
		return apperror.BadRequest(err.Error())
	}

	return nil
}
