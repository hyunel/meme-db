from typing import Dict, Optional, Any, Type
import logging
from accelerate import Accelerator
from .config import ModelConfig, ModelType
from .models.base import BaseModel
from .models.clip import CLIPModel
from .models.reranker import RerankerModel
from .models.text_embedding import TextEmbeddingModel
from .models.vlm import VLMModel, get_vlm_class

logger = logging.getLogger(__name__)


class ModelManager:
    """
    Manages the lifecycle of inference models.
    """

    _REGISTRY: Dict[ModelType, Type[BaseModel]] = {
        ModelType.CLIP: CLIPModel,
        ModelType.RERANKER: RerankerModel,
        ModelType.TEXT_EMBEDDING: TextEmbeddingModel,
        ModelType.VLM: VLMModel,  # Placeholder, will be handled specially
    }

    def __init__(self, config: ModelConfig):
        self.accelerator = Accelerator()
        self.models: Dict[ModelType, BaseModel] = {}
        self.config = config

        # Set default device if not specified for each model
        device = self.accelerator.device
        for sub_config in self.config.get_model_configs().values():
            if sub_config.device is None:
                sub_config.device = device

    def load_models(self) -> "ModelManager":
        """
        Initialize and load all configured models.
        """
        logger.info("Initializing models...")

        # Load models from registry
        for model_type, model_class in self._REGISTRY.items():
            if model_type == ModelType.VLM:
                # Dynamic VLM selection
                model_class = get_vlm_class(self.config)

            self.models[model_type] = model_class(self.config)

        logger.info("All models loaded successfully.")
        return self

    def __getitem__(self, model_type: ModelType) -> Any:
        """Helper to safely retrieve and cast model."""
        if model_type not in self.models:
            raise RuntimeError(f"{model_type.value} model not loaded")
        return self.models[model_type]
    
    def __iter__(self):
        """Iterator over loaded models."""
        return iter(self.models.items())
