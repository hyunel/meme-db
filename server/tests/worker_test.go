package tests

import (
	"context"
	"fmt"
	"maps"
	"sync"
	"testing"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/worker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// queueStore is a task queue in memory: Claim takes from the front within the rooms, Release puts a task back there.
type queueStore struct {
	mu       sync.Mutex
	pending  []*model.Task
	rooms    []map[string]int // Passed to each Claim
	finished int
}

func (s *queueStore) Claim(_ context.Context, limit int, rooms map[string]int) ([]*model.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rooms = append(s.rooms, maps.Clone(rooms))
	var claimed, rest []*model.Task
	taken := map[string]int{}
	for _, t := range s.pending {
		if room, held := rooms[t.JobType]; len(claimed) < limit && (!held || taken[t.JobType] < room) {
			taken[t.JobType]++
			t.Attempts++
			claimed = append(claimed, t)
		} else {
			rest = append(rest, t)
		}
	}
	s.pending = rest
	return claimed, nil
}

func (s *queueStore) Release(_ context.Context, id string, _ int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	task := &model.Task{ID: id, JobType: "embed", MaxAttempts: 3, TimeoutSecs: 60}
	s.pending = append([]*model.Task{task}, s.pending...)
	return nil
}

func (s *queueStore) Finish(context.Context, string, int, string, *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finished++
	return nil
}

func (s *queueStore) Retry(context.Context, string, int, time.Time, string) error {
	return fmt.Errorf("unexpected retry")
}
func (s *queueStore) Requeue(context.Context, []string) ([]*model.Task, error) { return nil, nil }
func (s *queueStore) Cancel(context.Context, string, string) (*model.Task, error) {
	return nil, nil
}
func (s *queueStore) CancelBatch(context.Context, string, string) ([]*model.Task, error) {
	return nil, nil
}
func (s *queueStore) RunNow(context.Context, string) (bool, error) { return false, nil }
func (s *queueStore) EnqueueScheduled(context.Context, string, string, []byte) (bool, error) {
	return false, nil
}

type busyError struct{}

func (busyError) Error() string { return "busy" }
func (busyError) Busy() bool    { return true }

func TestWorkerThrottlesToWhatItsDependencyLetsIn(t *testing.T) {
	const tasks, capacity = 60, 2
	store := &queueStore{}
	for i := range tasks {
		store.pending = append(store.pending, &model.Task{ID: fmt.Sprint(i), JobType: "embed", MaxAttempts: 3, TimeoutSecs: 60})
	}

	var mu sync.Mutex
	inFlight, refused := 0, 0
	w := worker.NewWorker(config.WorkerConfig{Concurrency: 8, PollInterval: 10 * time.Millisecond}, store)
	w.RegisterHandler("embed", worker.HandlerFunc(func(context.Context, *model.Task) error {
		mu.Lock()
		if inFlight >= capacity {
			refused++
			mu.Unlock()
			return busyError{}
		}
		inFlight++
		mu.Unlock()
		time.Sleep(2 * time.Millisecond)
		mu.Lock()
		inFlight--
		mu.Unlock()
		return nil
	}))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)

	require.Eventually(t, func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		return store.finished == tasks
	}, 5*time.Second, 5*time.Millisecond)

	// Unthrottled, the six it can't take would be turned away over and over
	mu.Lock()
	assert.Less(t, refused, tasks)
	mu.Unlock()

	// With the backlog gone, the job type is no longer held back
	assert.Eventually(t, func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		_, held := store.rooms[len(store.rooms)-1]["embed"]
		return !held
	}, time.Second, 5*time.Millisecond)
}
