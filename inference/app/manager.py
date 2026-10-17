from typing import Dict, Any
import logging
from .config import ModelConfig, ModelType
from .models.base import BaseModel
from .models.clip import CLIPModel
from .models.reranker import get_reranker_class
from .models.text_embedding import TextEmbeddingModel
from .models.vlm import get_vlm_class

logger = logging.getLogger(__name__)


class ModelManager:
    def __init__(self, config: ModelConfig):
        self.models: Dict[ModelType, BaseModel] = {}
        self.config = config

    def load_models(self) -> "ModelManager":
        logger.info("Initializing models...")

        c = self.config
        roles = {  # Class, and its section of the config
            ModelType.CLIP: (CLIPModel, c.clip),
            ModelType.RERANKER: (get_reranker_class(c), c.reranker),
            ModelType.TEXT_EMBEDDING: (TextEmbeddingModel, c.embedding),
            ModelType.VLM: (get_vlm_class(c), c.vlm.local),
        }
        for model_type, (model_class, settings) in roles.items():
            self.models[model_type] = model_class(c, None if model_class.remote else settings)

        logger.info("All models loaded successfully.")
        return self

    def __getitem__(self, model_type: ModelType) -> Any:
        if model_type not in self.models:
            raise RuntimeError(f"{model_type.value} model not loaded")
        return self.models[model_type]

    def __iter__(self):
        return iter(self.models.items())
