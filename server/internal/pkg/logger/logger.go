package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
)

// ANSI color codes
const (
	Reset  = "\033[0m"
	Red    = "\033[31m"
	Green  = "\033[32m"
	Yellow = "\033[33m"
	Blue   = "\033[34m"
	Purple = "\033[35m"
	Cyan   = "\033[36m"
	Gray   = "\033[37m"
)

type ColorHandler struct {
	opts   slog.HandlerOptions
	w      io.Writer
	mu     *sync.Mutex
	attrs  []slog.Attr
	groups []string
}

func NewColorHandler(w io.Writer, opts *slog.HandlerOptions) *ColorHandler {
	if opts == nil {
		opts = &slog.HandlerOptions{}
	}
	return &ColorHandler{
		opts: *opts,
		w:    w,
		mu:   &sync.Mutex{},
	}
}

func (h *ColorHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.opts.Level.Level() <= level
}

func (h *ColorHandler) Handle(ctx context.Context, r slog.Record) error {
	level := r.Level.String()

	var levelColor string
	switch r.Level {
	case slog.LevelDebug:
		levelColor = Gray
	case slog.LevelInfo:
		levelColor = Green
	case slog.LevelWarn:
		levelColor = Yellow
	case slog.LevelError:
		levelColor = Red
	default:
		levelColor = Reset
	}

	timeStr := r.Time.Format("2006/01/02 15:04:05")

	h.mu.Lock()
	defer h.mu.Unlock()

	// Format: TIME [LEVEL] MSG
	_, err := fmt.Fprintf(h.w, "%s %s[%s]%s %s", timeStr, levelColor, level, Reset, r.Message)
	if err != nil {
		return err
	}

	// Helper to print attributes
	printAttr := func(a slog.Attr) {
		fmt.Fprintf(h.w, " %s=%v", a.Key, a.Value.Any())
	}

	// Print stored attributes
	for _, a := range h.attrs {
		printAttr(a)
	}

	// Print record attributes
	r.Attrs(func(a slog.Attr) bool {
		printAttr(a)
		return true
	})

	fmt.Fprintln(h.w)
	return nil
}

func (h *ColorHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	copy(newAttrs[len(h.attrs):], attrs)

	return &ColorHandler{
		opts:   h.opts,
		w:      h.w,
		mu:     h.mu, // Share mutex
		attrs:  newAttrs,
		groups: h.groups,
	}
}

func (h *ColorHandler) WithGroup(name string) slog.Handler {
	// Simple implementation: just append to groups (not used in display for now but preserving structure)
	newGroups := make([]string, len(h.groups)+1)
	copy(newGroups, h.groups)
	newGroups[len(h.groups)] = name

	return &ColorHandler{
		opts:   h.opts,
		w:      h.w,
		mu:     h.mu,
		attrs:  h.attrs,
		groups: newGroups,
	}
}

// Setup configures the default slog logger with ColorHandler
func Setup() {
	handler := NewColorHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})
	logger := slog.New(handler)
	slog.SetDefault(logger)
}
