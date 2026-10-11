from typing import Dict, Any
import logging
from accelerate import Accelerator
from .config import ModelConfig, ModelType
from .models.base import BaseModel
from .models.clip import CLIPModel
from .models.reranker import RerankerModel
from .models.text_embedding import TextEmbeddingModel
from .models.vlm import get_vlm_class

logger = logging.getLogger(__name__)


class ModelManager:
    def __init__(self, config: ModelConfig):
        self.models: Dict[ModelType, BaseModel] = {}
        self.config = config

        device = Accelerator().device
        for sub_config in self.config.get_model_configs().values():
            if sub_config.device is None:
                sub_config.device = device

    def load_models(self) -> "ModelManager":
        logger.info("Initializing models...")
        classes = {
            ModelType.CLIP: CLIPModel,
            ModelType.RERANKER: RerankerModel,
            ModelType.TEXT_EMBEDDING: TextEmbeddingModel,
            ModelType.VLM: get_vlm_class(self.config),
        }
        for model_type, model_class in classes.items():
            self.models[model_type] = model_class(self.config)
        logger.info("All models loaded successfully.")
        return self

    def __getitem__(self, model_type: ModelType) -> Any:
        if model_type not in self.models:
            raise RuntimeError(f"{model_type.value} model not loaded")
        return self.models[model_type]

    def __iter__(self):
        return iter(self.models.items())
