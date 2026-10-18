from abc import ABC, abstractmethod
from typing import Any, Callable, Generic, List, Optional, TypeVar

from .resource import ResourceManager
from ..metrics import TaskMetrics

T = TypeVar("T")
R = TypeVar("R")


class Scheduler(ABC, Generic[T, R]):
    def __init__(
        self,
        resource_manager: ResourceManager,
        process_func: Callable[[Any], List[R]],
        prepare_func: Optional[Callable[[List[T]], Any]] = None,
        *,
        metrics: TaskMetrics,
    ):
        self.resource_manager = resource_manager
        self.process_func = process_func
        self.prepare_func = prepare_func
        self.metrics = metrics

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    @abstractmethod
    def queued(self) -> int:
        pass

    @abstractmethod
    async def submit(self, item: T, priority: int = 0, context: Any = None) -> R:
        pass
