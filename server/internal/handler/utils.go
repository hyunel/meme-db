package handler

import (
	"time"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

func BindAndValidate(c echo.Context, req any) error {
	if err := c.Bind(req); err != nil {
		return apperror.BadRequest("请求参数无效")
	}
	if err := c.Validate(req); err != nil {
		return apperror.BadRequest("请求参数无效：" + err.Error())
	}
	return nil
}

type PageQuery struct {
	Page     int `query:"page" validate:"omitempty,min=1"`
	PageSize int `query:"page_size" validate:"omitempty,min=1,max=100"`
}

func (q PageQuery) page() service.Page {
	size := q.PageSize
	if size == 0 {
		size = 20
	}
	return service.Page{Limit: size, Offset: (max(q.Page, 1) - 1) * size}
}

// RangeQuery bounds are Unix milliseconds.
type RangeQuery struct {
	From int64 `query:"from" json:"from" validate:"omitempty,min=0"`
	To   int64 `query:"to" json:"to" validate:"omitempty,min=0"`
}

func (q RangeQuery) timeRange() service.TimeRange {
	var r service.TimeRange
	if q.From > 0 {
		r.From = time.UnixMilli(q.From)
	}
	if q.To > 0 {
		r.To = time.UnixMilli(q.To)
	}
	return r
}

func optionalID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func limitOr(limit, def int) int {
	if limit <= 0 {
		return def
	}
	return limit
}
