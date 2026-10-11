import asyncio
from typing import Any, List, Callable, Generic, TypeVar
from .resource import ResourceManager

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

    async def start(self):
        pass

    async def stop(self):
        pass

    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        async with self.semaphore:
            results = await self.resource_manager.execute(self.process_func, [item], priority)

        if not results:
            raise RuntimeError("SimpleScheduler: no results returned")

        return results[0]
