package handler

import (
	"net/http"
	"strings"

	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

// TaskHandler lets administrators inspect and steer background tasks.
type TaskHandler struct {
	taskService *service.TaskService
}

func NewTaskHandler(taskService *service.TaskService) *TaskHandler {
	return &TaskHandler{taskService: taskService}
}

type ListTasksRequest struct {
	PageQuery
	RangeQuery
	States    []string `query:"state" validate:"max=5,dive,oneof=pending retrying running completed failed"`
	JobType   string   `query:"type" validate:"max=50"`
	Query     string   `query:"q" validate:"max=100"`
	Recurring bool     `query:"recurring"`
	Sort      string   `query:"sort" validate:"omitempty,oneof=due created finished"`
}

func (h *TaskHandler) List(c echo.Context) error {
	var req ListTasksRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.taskService.List(c.Request().Context(), service.TaskFilter{
		States:    req.States,
		JobType:   req.JobType,
		Query:     strings.TrimSpace(req.Query),
		Created:   req.timeRange(),
		Recurring: req.Recurring,
		Sort:      req.Sort,
	}, req.page())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

// Summary counts tasks per job type and state; the in-range counts cover tasks finished
// within the requested range.
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

// Retry requeues the failed tasks among the given IDs.
func (h *TaskHandler) Retry(c echo.Context) error {
	var req IDsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	n, err := h.taskService.Retry(c.Request().Context(), req.IDs)
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
