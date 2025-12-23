import asyncio
import time
import logging
from typing import Any, List, Callable, Optional, Generic, TypeVar
from dataclasses import dataclass, field
from asyncio import Future, PriorityQueue

logger = logging.getLogger(__name__)

T = TypeVar("T")  # Input type
R = TypeVar("R")  # Result type

@dataclass(order=True)
class Task(Generic[T]):
    priority: int
    id: str = field(compare=False)
    item: T = field(compare=False)
    future: Future = field(compare=False, default_factory=Future)
    created_at: float = field(compare=False, default_factory=time.time)

@dataclass(order=True)
class BatchRequest:
    priority: int
    func: Callable = field(compare=False)
    batch: List[Any] = field(compare=False)
    future: Future = field(compare=False, default_factory=Future)

class ResourceManager:
    """
    Global resource manager that executes batches based on priority.
    """
    def __init__(self, concurrency: int = 1):
        self.queue: PriorityQueue[BatchRequest] = PriorityQueue()
        self.worker_task: Optional[asyncio.Task] = None
        self.semaphore = asyncio.Semaphore(concurrency)
        self.running_tasks: set[asyncio.Task] = set()

    async def start(self):
        self.worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self):
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

        # Wait for all running tasks to complete (optional, or cancel them)
        if self.running_tasks:
            for t in self.running_tasks:
                t.cancel()
            await asyncio.gather(*self.running_tasks, return_exceptions=True)

        # Cancel all pending requests in the queue
        while not self.queue.empty():
            try:
                request = self.queue.get_nowait()
                if not request.future.done():
                    request.future.cancel()
            except asyncio.QueueEmpty:
                break

    async def execute(self, func: Callable[[List[T]], List[R]], batch: List[T], priority: int) -> List[R]:
        # PriorityQueue is min-heap, so negate priority
        request = BatchRequest(priority=-priority, func=func, batch=batch)
        await self.queue.put(request)
        return await request.future

    async def _worker_loop(self):
        while True:
            try:
                # Wait for a slot
                await self.semaphore.acquire()

                # Get request (waits if empty)
                request = await self.queue.get()

                # Spawn execution task
                task = asyncio.create_task(self._execute_request(request))
                self.running_tasks.add(task)
                task.add_done_callback(self.running_tasks.discard)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"ResourceManager worker error: {e}", exc_info=True)
                await asyncio.sleep(0.1)

    async def _execute_request(self, request: BatchRequest):
        loop = asyncio.get_running_loop()
        try:
            try:
                # Run synchronously in executor
                results = await loop.run_in_executor(None, request.func, request.batch)
                if not request.future.done():
                    request.future.set_result(results)
            except Exception as e:
                logger.error(f"Execution failed: {e}", exc_info=True)
                if not request.future.done():
                    request.future.set_exception(e)
            finally:
                self.queue.task_done()
        finally:
            self.semaphore.release()
