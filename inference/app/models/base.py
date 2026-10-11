from abc import ABC, abstractmethod
from typing import Dict, Callable
from ..config import ModelConfig, ModelType

DEFAULT_TASK = "Given a web search query, retrieve relevant passages that answer the query"

class BaseModel(ABC):
    is_gpu: bool = True

    def __init__(self, config: ModelConfig):
        self.config = config
        self._load_model()

    @abstractmethod
    def _load_model(self) -> None:
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        return {}
