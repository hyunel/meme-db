from abc import ABC, abstractmethod
from typing import Dict, Callable
import logging
from ..config import ModelConfig, ModelType

logger = logging.getLogger(__name__)

class BaseModel(ABC):
    """Abstract Base Class for all inference models."""

    is_gpu: bool = True

    def __init__(self, config: ModelConfig):
        self.config = config
        self._load_model()

    @abstractmethod
    def _load_model(self) -> None:
        """Load the model and processor/tokenizer."""
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        """Return a mapping of ModelType to the corresponding inference method."""
        return {}
