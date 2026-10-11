import asyncio
import time
from typing import Any, List, Callable, Generic, TypeVar
from .resource import ResourceManager
from ..metrics import TaskMetrics

T = TypeVar("T")  # Input type
R = TypeVar("R")  # Result type

class SimpleScheduler(Generic[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[List[T]], List[R]],
        concurrency: int = 8,
    ):
        self.resource_manager = resource_manager
        self.process_func = process_func
        self.semaphore = asyncio.Semaphore(concurrency)
        self.metrics = TaskMetrics('concurrent', concurrency)
        self.waiting = 0

    async def start(self):
        pass

    async def stop(self):
        pass

    def queued(self) -> int:
        return self.waiting

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
            async with self.semaphore:
                results = await self.resource_manager.execute(self.process_func, [item], priority, on_start)
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
