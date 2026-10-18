import threading
import time
from typing import Any, List, Callable, Optional
from .base import Scheduler, T, R
from .resource import ResourceManager
from ..metrics import TaskMetrics


class SimpleScheduler(Scheduler[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[Any], List[R]],
        prepare_func: Optional[Callable[[List[T]], Any]] = None,
    ):
        super().__init__(resource_manager, process_func, prepare_func, metrics=TaskMetrics('concurrent', resource_manager.concurrency))
        self.prepare_lock = threading.Lock()  # Tokenizers aren't thread-safe
        self.waiting = 0

    def queued(self) -> int:
        return self.waiting

    def _process(self, items: List[T]) -> List[R]:
        if self.prepare_func:
            with self.prepare_lock:
                items = self.prepare_func(items)
        return self.process_func(items)

    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        submitted = time.time()
        started = 0.0
        def on_start():
            nonlocal started
            started = time.time()
            self.waiting -= 1
            self.metrics.start(1)

        self.waiting += 1
        error = None
        try:
            results = await self.resource_manager.execute(self._process, [item], priority, on_start)
        except Exception as e:
            error = e
            raise
        finally:
            if started:
                self.metrics.finish([started - submitted], time.time() - started, error)
            else:
                self.waiting -= 1

        if not results:
            raise RuntimeError("SimpleScheduler: no results returned")

        return results[0]
