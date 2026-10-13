from abc import ABC, abstractmethod
from typing import Dict, Callable, Optional, Tuple
from ..config import ModelConfig, ModelType

DEFAULT_TASK = "Given a web search query, retrieve relevant passages that answer the query"

class BaseModel(ABC):
    is_gpu: bool = True
    name: str = ''  # The loaded model, for monitoring

    def __init__(self, config: ModelConfig):
        self.config = config
        self._load_model()

    @abstractmethod
    def _load_model(self) -> None:
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Optional[Callable], Callable]]:
        # (prepare, run): a GPU model's prepare readies a batch on a CPU thread, before it waits for the GPU.
        return {}
