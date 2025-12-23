from abc import ABC, abstractmethod
import logging
from ..config import ModelConfig

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
