package handler

import (
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type TaskHandler struct {
	taskService *service.TaskService
}

func NewTaskHandler(taskService *service.TaskService) *TaskHandler {
	return &TaskHandler{taskService: taskService}
}

type TaskFilterParams struct {
	RangeQuery
	States    []string `query:"state" json:"state" validate:"max=5,dive,oneof=pending retrying running completed failed"`
	JobType   string   `query:"type" json:"type" validate:"max=50"`
	Query     string   `query:"q" json:"q" validate:"max=100"`
	Recurring bool     `query:"recurring" json:"recurring"`
	Sort      string   `query:"sort" json:"sort" validate:"omitempty,oneof=due created finished"`
}

func (p TaskFilterParams) filter() service.TaskFilter {
	return service.TaskFilter{
		States:    p.States,
		JobType:   p.JobType,
		Query:     strings.TrimSpace(p.Query),
		Created:   p.timeRange(),
		Recurring: p.Recurring,
		Sort:      p.Sort,
	}
}

type ListTasksRequest struct {
	PageQuery
	TaskFilterParams
}

func (h *TaskHandler) List(c echo.Context) error {
	var req ListTasksRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.taskService.List(c.Request().Context(), req.filter(), req.page())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

func (h *TaskHandler) Summary(c echo.Context) error {
	var req RangeQuery
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	summary, err := h.taskService.Summary(c.Request().Context(), req.timeRange())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, summary)
}

type TaskRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *TaskHandler) Get(c echo.Context) error {
	var req TaskRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	task, err := h.taskService.Get(c.Request().Context(), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, task)
}

type RetryTasksRequest struct {
	IDs    []string          `json:"ids" validate:"max=1000,dive,uuid"`
	Filter *TaskFilterParams `json:"filter"`
}

func (h *TaskHandler) Retry(c echo.Context) error {
	var req RetryTasksRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	var n int
	var err error
	switch {
	case len(req.IDs) > 0:
		n, err = h.taskService.Retry(c.Request().Context(), req.IDs)
	case req.Filter != nil:
		if err := c.Validate(req.Filter); err != nil {
			return apperror.BadRequest("请求参数无效：" + err.Error())
		}
		n, err = h.taskService.RetryMatching(c.Request().Context(), req.Filter.filter())
	default:
		return apperror.BadRequest("请指定要重试的任务")
	}
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, CountResponse{Count: n})
}

func (h *TaskHandler) RunNow(c echo.Context) error {
	var req TaskRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.taskService.RunNow(c.Request().Context(), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *TaskHandler) Cancel(c echo.Context) error {
	var req TaskRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.taskService.Cancel(c.Request().Context(), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
