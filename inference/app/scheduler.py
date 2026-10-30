import asyncio
import time
import logging
import uuid
from typing import Any, List, Callable, Optional, Dict, Generic, TypeVar
from .resource import Task, ResourceManager
from .metrics import TaskMetrics

logger = logging.getLogger(__name__)

T = TypeVar("T")
R = TypeVar("R")


class Scheduler(Generic[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[Any], List[R]],
        prepare_func: Optional[Callable[[List[T]], Any]] = None,
        batch_size: int = 1,
        batch_latency: float = 0.0,
    ):
        self.resource_manager = resource_manager
        self.process_func = process_func  # May give an Exception in place of a result that failed alone
        self.prepare_func = prepare_func
        self.batch_size = batch_size  # Requests per call of process_func
        self.batch_latency = batch_latency  # Seconds a batch waits to fill
        self.metrics = TaskMetrics()

        self.queue: asyncio.PriorityQueue[Task[T]] = asyncio.PriorityQueue()
        self.active_tasks: Dict[str, Task[T]] = {}
        self.slots = asyncio.Semaphore(self.concurrency)
        self.prepare_lock = asyncio.Lock()  # Tokenizers aren't thread-safe
        self.batches: set[asyncio.Task] = set()
        self.worker_task: Optional[asyncio.Task] = None

    @property
    def concurrency(self) -> int:  # Batches in flight: as many as its resource runs at once
        return self.resource_manager.concurrency

    @property
    def capacity(self) -> int:  # Requests running at once when full: a round
        return self.batch_size * self.concurrency

    async def start(self):
        self.worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self):
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

        for task in list(self.active_tasks.values()):
            task.future.cancel()  # A running batch stops once its callers are gone
        await asyncio.gather(*self.batches, return_exceptions=True)

    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        # Negate priority for min-heap
        task = Task(priority=-priority, id=str(uuid.uuid4()), item=item)

        def left(future: asyncio.Future):
            if future.cancelled():  # Its caller left before a result
                self.active_tasks.pop(task.id, None)
                self.metrics.window.abandoned += 1

        task.future.add_done_callback(left)
        self.active_tasks[task.id] = task
        await self.queue.put(task)

        if context:
            context.add_done_callback(lambda _: task.future.cancel())
            if context.done():
                task.future.cancel()

        return await task.future

    def queued(self) -> int:
        return max(0, len(self.active_tasks) - self.metrics.running)

    async def _get_next_valid_task(self) -> Task[T]:
        while True:
            task = await self.queue.get()
            if not task.future.done():  # Cancelled tasks stay queued until popped
                return task

    async def _worker_loop(self):
        while True:
            await self.slots.acquire()  # A batch forms once it can run, so a backlog fills it
            batch = [await self._get_next_valid_task()]
            formed_at = time.monotonic()
            try:
                async with asyncio.timeout(self.batch_latency):
                    while len(batch) < self.batch_size:
                        batch.append(await self._get_next_valid_task())
            except TimeoutError:
                pass  # Latency window expired

            logger.debug("Batch formed: size=%d reason=%s wait_ms=%.1f queued=%d", len(batch),
                         "full" if len(batch) == self.batch_size else "timeout",
                         (time.monotonic() - formed_at) * 1000, self.queue.qsize())
            run = asyncio.create_task(self._process_batch(batch))
            self.batches.add(run)
            run.add_done_callback(self.batches.discard)
            run.add_done_callback(lambda _: self.slots.release())

    async def _process_batch(self, batch: List[Task[T]]):
        batch = [t for t in batch if not t.future.done()]  # Callers may leave while it fills
        if not batch:
            return

        run = asyncio.current_task()
        def left(_):
            if all(t.future.done() for t in batch):  # Nobody waits for it any more
                run.cancel()
        for task in batch:
            task.future.add_done_callback(left)

        started = 0.0
        def on_start():
            nonlocal started
            started = time.time()
            self.metrics.start(len(batch))

        results: List[Any] = []
        try:
            inputs = [t.item for t in batch]
            if self.prepare_func:  # CPU work, kept out of the resource slot
                async with self.prepare_lock:
                    inputs = await asyncio.get_running_loop().run_in_executor(None, self.prepare_func, inputs)
            results = await self.resource_manager.execute(self.process_func, inputs, max(-t.priority for t in batch), on_start)
            if len(results) != len(batch):
                raise RuntimeError(f"Batch processing returned {len(results)} results for {len(batch)} inputs")
        except Exception as e:
            logger.error(f"Batch processing failed: {e}", exc_info=True)
            results = [e] * len(batch)
            if not started:  # Failed while preparing
                on_start()
        finally:
            if started:
                stayed = [(t, r) for t, r in zip(batch, results) if not t.future.done()]  # Those who left count as abandoned
                self.metrics.finish(len(batch), [started - t.created_at for t, _ in stayed], time.time() - started,
                                    [r for _, r in stayed if isinstance(r, Exception)])

        for task, result in zip(batch, results):
            self.active_tasks.pop(task.id, None)
            if task.future.done():
                continue
            if isinstance(result, Exception):
                task.future.set_exception(result)
            else:
                task.future.set_result(result)
