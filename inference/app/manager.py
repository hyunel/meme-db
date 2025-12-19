from typing import Dict, Optional, Any
import logging
import torch
from enum import Enum
from pathlib import Path
from accelerate import Accelerator
from .config import ModelConfig
from .models.base import BaseModel, ModelType
from .models.clip import CLIPModel
from .models.reranker import RerankerModel
from .models.text_embedding import TextEmbeddingModel
from .models.vlm import LocalVLM, OpenAIVLM, VLMModel

logger = logging.getLogger(__name__)


class ModelManager:
    """
    Manages the lifecycle of inference models.
    """

    def __init__(self, config_path: Optional[str] = None):
        self.accelerator = Accelerator()
        self.models: Dict[ModelType, BaseModel] = {}

        # Load config from YAML if provided, otherwise use defaults
        if config_path:
            self.config = ModelConfig.from_yaml(config_path)
        else:
            self.config = ModelConfig()

        if not self.config.device:
            self.config.device = self.accelerator.device

    def load_models(self) -> "ModelManager":
        """
        Initialize and load all configured models.
        """
        logger.info("Initializing models...")

        # Load CLIP
        self.models[ModelType.CLIP] = CLIPModel(self.config)

        # Load Reranker
        self.models[ModelType.RERANKER] = RerankerModel(self.config)

        # Load Text Embedding
        self.models[ModelType.TEXT_EMBEDDING] = TextEmbeddingModel(self.config)

        # Load VLM
        clazz = {
            "openai": OpenAIVLM,
            "local": LocalVLM
        }.get(self.config.vlm.provider)

        if not clazz:
            raise ValueError(f"Unsupported VLM provider: {self.config.vlm.provider}")

        self.models[ModelType.VLM] = clazz(self.config)

        logger.info("All models loaded successfully.")
        return self

    def _get_model_by_type(self, model_type: ModelType) -> Any:
        """Helper to safely retrieve and cast model."""
        if model_type not in self.models:
            raise RuntimeError(f"{model_type.value} model not loaded")
        return self.models[model_type]

    @property
    def clip(self) -> CLIPModel:
        return self._get_model_by_type(ModelType.CLIP)

    @property
    def reranker(self) -> RerankerModel:
        return self._get_model_by_type(ModelType.RERANKER)

    @property
    def text_embedding(self) -> TextEmbeddingModel:
        return self._get_model_by_type(ModelType.TEXT_EMBEDDING)

    @property
    def vlm(self) -> VLMModel:
        return self._get_model_by_type(ModelType.VLM)
