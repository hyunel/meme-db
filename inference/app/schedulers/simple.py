import asyncio
import logging
from typing import Any, List, Callable, Generic, TypeVar
from .resource import ResourceManager

logger = logging.getLogger(__name__)

T = TypeVar("T")  # Input type
R = TypeVar("R")  # Result type

class SimpleScheduler(Generic[T, R]):
    """
    A simple scheduler that submits tasks immediately without batching.
    Useful for CPU/IO bound tasks where batching latency is not desired.
    """
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[List[T]], List[R]],
        concurrency: int = 8,
    ):
        self.resource_manager = resource_manager
        self.process_func = process_func
        self.semaphore = asyncio.Semaphore(concurrency)

    async def start(self):
        """No background worker needed for simple scheduler."""
        pass

    async def stop(self):
        """Nothing to stop."""
        pass

    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        """
        Submits a single item to the resource manager.
        Wraps the item in a list for the process_func and unwraps the result.
        """
        # Execute immediately via resource manager
        # We wrap the single item in a list as process_func expects List[T]
        async with self.semaphore:
            results = await self.resource_manager.execute(self.process_func, [item], priority)

        if not results:
            raise RuntimeError("SimpleScheduler: no results returned")

        return results[0]
