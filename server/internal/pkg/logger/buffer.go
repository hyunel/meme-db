package logger

import (
	"sync"
	"time"
)

// Entry is a log record kept for the admin console.
type Entry struct {
	ID      int64             `json:"id"`
	Time    time.Time         `json:"time"`
	Level   string            `json:"level"` // debug | info | warn | error
	Message string            `json:"message"`
	Attrs   map[string]string `json:"attrs"`
}

// Buffer keeps the latest log entries in memory.
type Buffer struct {
	mu      sync.Mutex
	entries []Entry // Ring buffer; the oldest entry is at start once full
	start   int
	lastID  int64
}

func NewBuffer(size int) *Buffer {
	return &Buffer{entries: make([]Entry, 0, size)}
}

func (b *Buffer) add(e Entry) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.lastID++
	e.ID = b.lastID
	if len(b.entries) < cap(b.entries) {
		b.entries = append(b.entries, e)
		return
	}
	b.entries[b.start] = e
	b.start = (b.start + 1) % len(b.entries)
}

// After returns the kept entries with an ID greater than id, oldest first.
func (b *Buffer) After(id int64) []Entry {
	b.mu.Lock()
	defer b.mu.Unlock()

	out := []Entry{}
	for i := range b.entries {
		if e := b.entries[(b.start+i)%len(b.entries)]; e.ID > id {
			out = append(out, e)
		}
	}
	return out
}
