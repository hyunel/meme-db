from functools import partial
from typing import List, Dict, Callable, Tuple
import logging
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoProcessor, BatchFeature
from .base import BaseModel
from ..config import ModelType

logger = logging.getLogger(__name__)

class CLIPModel(BaseModel):
    def _load_model(self) -> None:
        model_id = self.name = "google/siglip2-base-patch16-224"
        logger.info(f"Loading CLIP model: {model_id} on {self.config.clip.device}")

        self.model = AutoModel.from_pretrained(
            model_id,
            dtype=self.config.clip.dtype,
            attn_implementation=self.config.clip.attn_implementation
        ).to(self.config.clip.device).eval()

        self.processor = AutoProcessor.from_pretrained(model_id, use_fast=True)

        self.get_image_features = self.model.get_image_features
        self.get_text_features = self.model.get_text_features
        if self.config.clip.compile:
            self.get_image_features = torch.compile(self.get_image_features)
            self.get_text_features = torch.compile(self.get_text_features)

    def embed(self, get_features: Callable, inputs: BatchFeature) -> List[List[float]]:
        with torch.no_grad():
            features = get_features(**inputs.to(self.config.clip.device))
            features = F.normalize(features, p=2, dim=1)
            return features.float().cpu().numpy().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Callable, Callable]]:
        return {
            ModelType.CLIP_IMAGE: (
                lambda images: self.processor(images=images, return_tensors="pt"),
                partial(self.embed, self.get_image_features),
            ),
            ModelType.CLIP_TEXT: (
                # SigLIP was trained on text padded to 64 tokens, also its position limit.
                lambda texts: self.processor(text=texts, padding="max_length", truncation=True, max_length=64, return_tensors="pt"),
                partial(self.embed, self.get_text_features),
            ),
        }
