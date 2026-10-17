package service

import (
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
)

func orderByID[T any](items []T, ids []string, id func(T) string) []T {
	byID := make(map[string]T, len(items))
	for _, item := range items {
		byID[id(item)] = item
	}
	ordered := make([]T, 0, len(items))
	for _, i := range ids {
		if item, ok := byID[i]; ok {
			ordered = append(ordered, item)
			delete(byID, i)
		}
	}
	return ordered
}

func missing[T any](ids []string, items []T, id func(T) string) []string {
	have := make(map[string]bool, len(items))
	for _, item := range items {
		have[id(item)] = true
	}
	out := []string{}
	for _, i := range ids {
		if !have[i] {
			out = append(out, i)
		}
	}
	return out
}

// nextPage trims rows fetched one past the limit, giving the cursor of the page after them when that row came.
func nextPage[T any](rows []T, limit int, cursor func(T) string) ([]T, *string) {
	if len(rows) <= limit {
		return rows, nil
	}
	next := cursor(rows[limit-1])
	return rows[:limit], &next
}

// rankCursor reads the cursor of a ranked list, "<score>_<id>" of the last row before.
func rankCursor(cursor string) (int, string, error) {
	score, id, _ := strings.Cut(cursor, "_")
	n, err := strconv.Atoi(score)
	if err != nil || uuid.Validate(id) != nil {
		return 0, "", apperror.BadRequest("invalid_cursor", "invalid cursor")
	}
	return n, id, nil
}

type (
	Page       = repository.Page
	TimeRange  = repository.TimeRange
	MemeFilter = repository.MemeFilter
	UserFilter = repository.UserFilter
	TaskFilter = repository.TaskFilter
)
