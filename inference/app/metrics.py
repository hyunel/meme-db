import asyncio
import logging
import math
import time
from collections import Counter, deque
from dataclasses import dataclass, field

import psutil

logger = logging.getLogger(__name__)

SAMPLE_SECONDS = 15
HISTORY = 24 * 3600 // SAMPLE_SECONDS
RECENT_ERRORS = 20

# Latency histogram bucket i holds latencies up to BASE_MS * RATIO**i, so percentiles merge across any range.
BASE_MS = 0.5
RATIO = 1.15


def _bucket(ms: float) -> int:
    return max(0, math.ceil(math.log(max(ms, BASE_MS) / BASE_MS, RATIO)))


def _percentile(hist: Counter, q: float) -> float | None:
    total = sum(hist.values())
    if not total:
        return None

    seen = 0
    for i in sorted(hist):
        seen += hist[i]
        if seen >= q * total:
            return BASE_MS * RATIO ** i


@dataclass
class Window:
    requests: int = 0
    errors: int = 0
    latency: Counter = field(default_factory=Counter)  # Histogram buckets of request latency
    queue_ms: float = 0  # Summed over requests
    exec_ms: float = 0  # Summed over requests
    batches: Counter = field(default_factory=Counter)  # Batch size -> batches
    queued: int = 0  # Queue length when the window closed

    def add(self, other: "Window"):
        self.requests += other.requests
        self.errors += other.errors
        self.latency.update(other.latency)
        self.queue_ms += other.queue_ms
        self.exec_ms += other.exec_ms
        self.batches.update(other.batches)


def _merge(windows) -> Window:
    total = Window()
    for w in windows:
        total.add(w)
    return total


class TaskMetrics:
    def __init__(self, schedule: str, limit: int):
        self.schedule = schedule  # batch | concurrent
        self.limit = limit  # Batch size or concurrency
        self.running = 0
        self.window = Window()
        self.errors: deque[tuple[float, str]] = deque(maxlen=RECENT_ERRORS)

    def start(self, n: int):
        self.running += n

    def finish(self, waits: list[float], exec_seconds: float, error: Exception | None = None):
        n = len(waits)
        self.running -= n

        w = self.window
        w.requests += n
        w.batches[n] += 1
        w.queue_ms += sum(waits) * 1000
        w.exec_ms += exec_seconds * 1000 * n
        for wait in waits:
            w.latency[_bucket((wait + exec_seconds) * 1000)] += 1

        if error:
            w.errors += n
            self.errors.append((time.time(), str(error) or type(error).__name__))


@dataclass
class Sample:
    t: float
    cpu: float
    mem: int
    proc_cpu: float  # This process's share of all cores
    proc_mem: int  # This process's resident memory
    gpus: list[tuple[float, int]]  # Utilization % and memory used, per device
    tasks: dict[str, Window]


def _gpu_handles(indices: list[int]):
    if not indices:
        return None, []
    try:
        import pynvml
        pynvml.nvmlInit()
        return pynvml, [(i, pynvml.nvmlDeviceGetHandleByIndex(i)) for i in indices]
    except Exception as e:  # No NVIDIA driver, or no GPU at all
        logger.info(f"GPU metrics unavailable: {e}")
        return None, []


def _mean(values):
    return sum(values) / len(values)


class Monitor:
    def __init__(self, schedulers: dict, models: list[dict], gpus: list[int]):
        self.schedulers = schedulers  # Task type -> scheduler
        self.models = models
        self.started_at = time.time()
        self.samples: deque[Sample] = deque(maxlen=HISTORY)
        self.nvml, self.handles = _gpu_handles(gpus)  # The CUDA GPUs models run on
        self.task: asyncio.Task | None = None
        self.process = psutil.Process()
        psutil.cpu_percent(None)  # The first readings only start the measurement
        self.process.cpu_percent(None)

    async def start(self):
        self.task = asyncio.create_task(self._loop())

    async def stop(self):
        if self.task:
            self.task.cancel()

    async def _loop(self):
        while True:
            await asyncio.sleep(SAMPLE_SECONDS)
            try:
                self.samples.append(self._sample())
            except Exception:
                logger.exception("Failed to sample metrics")

    def _sample(self) -> Sample:
        tasks = {}
        for kind, scheduler in self.schedulers.items():
            w, scheduler.metrics.window = scheduler.metrics.window, Window()
            w.queued = scheduler.queued()
            tasks[kind] = w

        vm = psutil.virtual_memory()
        gpus = [(self.nvml.nvmlDeviceGetUtilizationRates(h).gpu, self.nvml.nvmlDeviceGetMemoryInfo(h).used) for _, h in self.handles]
        return Sample(t=time.time(), cpu=psutil.cpu_percent(None), mem=vm.total - vm.available,
                      proc_cpu=self.process.cpu_percent(None) / psutil.cpu_count(), proc_mem=self.process.memory_info().rss, gpus=gpus, tasks=tasks)

    def snapshot(self, span: int, step: int) -> dict:
        now = time.time()
        start = now - span
        samples = [s for s in self.samples if s.t >= start]

        first = math.ceil(start / step) * step
        steps: list[list[Sample]] = [[] for _ in range(int((now - first) // step) + 1)]
        for s in samples:
            if s.t >= first:
                steps[int((s.t - first) // step)].append(s)

        series = []
        task_series = {kind: [] for kind in self.schedulers}
        for i, group in enumerate(steps):
            t = int((first + i * step) * 1000)
            if not group:  # Not running then; charts break the line here
                series.append({'t': t, 'cpu': None, 'mem': None, 'proc_cpu': None, 'proc_mem': None, 'gpus': [{'util': None, 'vram': None} for _ in self.handles],
                               'throughput': None, 'p95': None, 'error_rate': None, 'queued': None})
                for points in task_series.values():
                    points.append({'t': t, 'p50': None, 'p95': None, 'p99': None, 'queue_ms': None, 'exec_ms': None, 'queue': None, 'throughput': None, 'errors': None})
                continue

            seconds = len(group) * SAMPLE_SECONDS
            windows = {kind: _merge(s.tasks[kind] for s in group) for kind in self.schedulers}
            total = _merge(windows.values())
            interactive = _merge(w for kind, w in windows.items() if kind != 'vlm')  # VLM captioning runs in the background and takes seconds
            series.append({
                't': t,
                'cpu': _mean([s.cpu for s in group]),
                'mem': _mean([s.mem for s in group]),
                'proc_cpu': _mean([s.proc_cpu for s in group]),
                'proc_mem': _mean([s.proc_mem for s in group]),
                'gpus': [{'util': _mean([s.gpus[d][0] for s in group]), 'vram': _mean([s.gpus[d][1] for s in group])} for d in range(len(self.handles))],
                'throughput': total.requests / seconds,
                'p95': _percentile(interactive.latency, 0.95),
                'error_rate': total.errors / total.requests * 100 if total.requests else 0,
                'queued': max(sum(w.queued for w in s.tasks.values()) for s in group),
            })
            for kind, w in windows.items():
                task_series[kind].append({
                    't': t,
                    'p50': _percentile(w.latency, 0.5),
                    'p95': _percentile(w.latency, 0.95),
                    'p99': _percentile(w.latency, 0.99),
                    'queue_ms': w.queue_ms / w.requests if w.requests else None,
                    'exec_ms': w.exec_ms / w.requests if w.requests else None,
                    'queue': max(s.tasks[kind].queued for s in group),
                    'throughput': w.requests / seconds,
                    'errors': w.errors,
                })

        return {
            'now': int(now * 1000),
            'started_at': int(self.started_at * 1000),
            'mem_total': psutil.virtual_memory().total,
            'gpus': [{'id': f'cuda:{i}', 'name': self.nvml.nvmlDeviceGetName(h), 'vram_total': self.nvml.nvmlDeviceGetMemoryInfo(h).total} for i, h in self.handles],
            'models': self.models,
            'series': series,
            'tasks': [self._task(kind, scheduler, samples, start) for kind, scheduler in self.schedulers.items()],
            'task_series': task_series,
        }

    def _task(self, kind: str, scheduler, samples: list[Sample], start: float) -> dict:
        m = scheduler.metrics
        w = _merge(s.tasks[kind] for s in samples)
        seconds = len(samples) * SAMPLE_SECONDS
        recent = [s.tasks[kind].queued for s in samples[-5:]]
        batches = sum(w.batches.values())

        sizes = [1]
        while sizes[-1] < m.limit:
            sizes.append(min(sizes[-1] * 2, m.limit))
        dist = [{'size': str(hi) if lo == hi else f'{lo}–{hi}', 'count': sum(c for size, c in w.batches.items() if lo <= size <= hi)}
                for lo, hi in zip([1] + [s + 1 for s in sizes[:-1]], sizes)]

        return {
            'kind': kind,
            'schedule': m.schedule,
            'limit': m.limit,
            'requests': w.requests,
            'queue': scheduler.queued(),
            'queue_growing': len(recent) == 5 and all(q > 0 for q in recent) and recent[-1] > recent[0],
            'running': m.running,
            'avg_batch': sum(size * c for size, c in w.batches.items()) / batches if m.schedule == 'batch' and batches else None,
            'throughput': w.requests / seconds if w.requests else None,
            'p50': _percentile(w.latency, 0.5),
            'p95': _percentile(w.latency, 0.95),
            'p99': _percentile(w.latency, 0.99),
            'errors': w.errors,
            'error_rate': w.errors / w.requests * 100 if w.requests else None,
            'batch_dist': dist if m.schedule == 'batch' else [],
            'recent_errors': [{'at': int(t * 1000), 'message': msg} for t, msg in reversed(m.errors) if t >= start],
        }
