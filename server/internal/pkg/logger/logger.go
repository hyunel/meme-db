package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

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
	sink   chan<- Entry // Optional copy of every record
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

	printAttr := func(a slog.Attr) {
		fmt.Fprintf(h.w, " %s=%v", a.Key, a.Value.Any())
	}

	for _, a := range h.attrs {
		printAttr(a)
	}

	r.Attrs(func(a slog.Attr) bool {
		printAttr(a)
		return true
	})

	fmt.Fprintln(h.w)

	if h.sink != nil {
		attrs := make(map[string]string, len(h.attrs)+r.NumAttrs())
		for _, a := range h.attrs {
			attrs[a.Key] = fmt.Sprint(a.Value.Any())
		}
		r.Attrs(func(a slog.Attr) bool {
			attrs[a.Key] = fmt.Sprint(a.Value.Any())
			return true
		})
		select {
		case h.sink <- Entry{Time: r.Time, Level: strings.ToLower(level), Message: r.Message, Attrs: attrs}:
		default: // Never block logging; the record is still on stdout
		}
	}
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
		sink:   h.sink,
	}
}

func (h *ColorHandler) WithGroup(name string) slog.Handler {
	// Groups are kept but not displayed
	newGroups := make([]string, len(h.groups)+1)
	copy(newGroups, h.groups)
	newGroups[len(h.groups)] = name

	return &ColorHandler{
		opts:   h.opts,
		w:      h.w,
		mu:     h.mu,
		attrs:  h.attrs,
		groups: newGroups,
		sink:   h.sink,
	}
}

type Entry struct {
	Time    time.Time
	Level   string // debug | info | warn | error
	Message string
	Attrs   map[string]string
}

func Setup() <-chan Entry {
	handler := NewColorHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})
	entries := make(chan Entry, 4096)
	handler.sink = entries
	slog.SetDefault(slog.New(handler))
	return entries
}
