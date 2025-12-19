from abc import ABC, abstractmethod
from enum import Enum
from typing import TYPE_CHECKING
import logging
from ..config import ModelConfig

logger = logging.getLogger(__name__)


class ModelType(str, Enum):
    """Enum for different model types."""
    CLIP = "clip"
    TEXT_EMBEDDING = "text_embedding"
    RERANKER = "reranker"
    VLM = "vlm"


class BaseModel(ABC):
    """Abstract Base Class for all inference models."""

    def __init__(self, config: ModelConfig):
        self.config = config
        self._load_model()

    @abstractmethod
    def _load_model(self) -> None:
        """Load the model and processor/tokenizer."""
        pass
