import asyncio
import time
import logging
import uuid
from typing import Any, List, Callable, Optional, Generic, TypeVar, Dict
from .resource import Task, ResourceManager

logger = logging.getLogger(__name__)

T = TypeVar("T")  # Input type
R = TypeVar("R")  # Result type

class BatchScheduler(Generic[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[List[T]], List[R]],
        batch_size: int,
        max_latency: float,
    ):
        self.resource_manager = resource_manager
        self.process_func = process_func
        self.batch_size = batch_size
        self.max_latency = max_latency

        self.queue: asyncio.PriorityQueue[Task[T]] = asyncio.PriorityQueue()
        self.active_tasks: Dict[str, Task[T]] = {}
        self.worker_task: Optional[asyncio.Task] = None

    async def start(self):
        self.worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self):
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

        # Cancel all active tasks
        for task in self.active_tasks.values():
            if not task.future.done():
                task.future.cancel()
        self.active_tasks.clear()

    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        task_id = str(uuid.uuid4())
        # Negate priority for min-heap
        task = Task(priority=-priority, id=task_id, item=item)

        self.active_tasks[task_id] = task
        await self.queue.put(task)

        if context:
            context.add_done_callback(lambda _: self.cancel_task(task_id))
            if context.done():
                self.cancel_task(task_id)

        return await task.future

    def cancel_task(self, task_id: str):
        if task_id in self.active_tasks:
            task = self.active_tasks.pop(task_id)
            logger.debug(f"Task {task_id} cancelled")
            if not task.future.done():
                task.future.cancel()

    async def _get_next_valid_task(self) -> Task[T]:
        """Get next valid task, discarding cancelled ones."""
        while True:
            task = await self.queue.get()
            # If task was cancelled externally (removed from active_tasks or future cancelled)
            if not task.future.done():
                return task
            # If we are here, task is done/cancelled, loop again

    async def _worker_loop(self):
        while True:
            try:
                # 1. Wait for the first valid item (blocking)
                first_task = await self._get_next_valid_task()
                batch = [first_task]

                # 2. Try to fill the batch within latency window
                deadline = first_task.created_at + self.max_latency
                timeout = max(0, deadline - time.time())

                try:
                    async with asyncio.timeout(timeout):
                        while len(batch) < self.batch_size:
                            task = await self._get_next_valid_task()
                            batch.append(task)
                except (TimeoutError, asyncio.TimeoutError):
                    pass # Latency window expired
                except asyncio.CancelledError:
                    raise # Propagate cancellation to stop loop

                # 3. Process the batch
                await self._process_batch(batch)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"BatchScheduler worker error: {e}", exc_info=True)
                await asyncio.sleep(1)

    async def _process_batch(self, batch: List[Task[T]]):
        # Double check validity before processing (in case of race conditions during fill)
        valid_batch = [t for t in batch if not t.future.done()]
        if not valid_batch:
            return

        inputs = [t.item for t in valid_batch]
        batch_priority = max(-t.priority for t in valid_batch)

        try:
            results = await self.resource_manager.execute(self.process_func, inputs, batch_priority)

            if len(results) != len(inputs):
                raise RuntimeError(f"Batch processing returned {len(results)} results for {len(inputs)} inputs")

            for task, result in zip(valid_batch, results):
                if task.id in self.active_tasks:
                    self.active_tasks.pop(task.id)
                if not task.future.done():
                    task.future.set_result(result)

        except Exception as e:
            logger.error(f"Batch processing failed: {e}", exc_info=True)
            for task in valid_batch:
                if task.id in self.active_tasks:
                    self.active_tasks.pop(task.id)
                if not task.future.done():
                    task.future.set_exception(e)
