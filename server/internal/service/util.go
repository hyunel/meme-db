package service

import "github.com/hyunel/MemeDB/internal/repository"

// orderByID arranges items in the order of ids, dropping IDs without an item.
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

// missing returns the IDs without an item.
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

// Filter and paging types of the repositories that service methods accept.
type (
	Page       = repository.Page
	TimeRange  = repository.TimeRange
	MemeFilter = repository.MemeFilter
	UserFilter = repository.UserFilter
	TaskFilter = repository.TaskFilter
)
