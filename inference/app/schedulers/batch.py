import asyncio
import time
import logging
import uuid
from typing import Any, List, Callable, Optional, Dict
from .base import Scheduler, T, R
from .resource import Task, ResourceManager
from ..metrics import TaskMetrics

logger = logging.getLogger(__name__)


class BatchScheduler(Scheduler[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[Any], List[R]],
        batch_size: int,
        max_latency: float,
        prepare_func: Optional[Callable[[List[T]], Any]] = None,
    ):
        super().__init__(resource_manager, process_func, prepare_func, metrics=TaskMetrics('batch', batch_size))
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

    def queued(self) -> int:
        return max(0, len(self.active_tasks) - self.metrics.running)

    async def _get_next_valid_task(self) -> Task[T]:
        while True:
            task = await self.queue.get()
            if not task.future.done():  # Cancelled tasks stay queued until popped
                return task

    async def _worker_loop(self):
        while True:
            try:
                first_task = await self._get_next_valid_task()
                batch = [first_task]

                try:
                    async with asyncio.timeout(max(0, first_task.created_at + self.max_latency - time.time())):
                        while len(batch) < self.batch_size:
                            batch.append(await self._get_next_valid_task())
                except TimeoutError:
                    pass  # Latency window expired

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

        started = 0.0
        def on_start():
            nonlocal started
            started = time.time()
            self.metrics.start(len(valid_batch))

        error = None
        try:
            if self.prepare_func:  # CPU work, kept out of the resource slot
                inputs = await asyncio.get_running_loop().run_in_executor(None, self.prepare_func, inputs)
            results = await self.resource_manager.execute(self.process_func, inputs, batch_priority, on_start)
            if len(results) != len(valid_batch):
                raise RuntimeError(f"Batch processing returned {len(results)} results for {len(valid_batch)} inputs")
        except Exception as e:
            logger.error(f"Batch processing failed: {e}", exc_info=True)
            error = e
            if not started:  # Failed while preparing
                on_start()
        finally:
            if started:
                self.metrics.finish([started - t.created_at for t in valid_batch], time.time() - started, error)

        for i, task in enumerate(valid_batch):
            self.active_tasks.pop(task.id, None)
            if task.future.done():
                continue
            if error:
                task.future.set_exception(error)
            else:
                task.future.set_result(results[i])
