from typing import List
import logging
import torch
from PIL import Image
import torch.nn.functional as F
from transformers import AutoModel, AutoProcessor
from .base import BaseModel

logger = logging.getLogger(__name__)

class CLIPModel(BaseModel):
    """
    CLIP Model wrapper for Image and Text Embeddings.
    Uses SigLIP2 by default.
    """

    def _load_model(self) -> None:
        model_id = "google/siglip2-base-patch16-224"
        logger.info(f"Loading CLIP model: {model_id} on {self.config.clip.device}")

        self.model = AutoModel.from_pretrained(
            model_id,
            dtype=self.config.clip.dtype,
            attn_implementation=self.config.clip.attn_implementation
        ).to(self.config.clip.device).eval()

        self.processor = AutoProcessor.from_pretrained(model_id, use_fast=True)

        if self.config.clip.compile:
            # Note: partial compilation of methods
            self.get_image_features = torch.compile(self.model.get_image_features)
            self.get_text_features = torch.compile(self.model.get_text_features)
        else:
            self.get_image_features = self.model.get_image_features
            self.get_text_features = self.model.get_text_features

    def get_image_embedding(self, images: List[Image.Image]) -> List[List[float]]:
        """
        Generate embeddings for a list of images.

        Args:
            images: List of PIL Images.

        Returns:
            List of embedding vectors (floats).
        """
        inputs = self.processor(images=images, return_tensors="pt").to(self.config.clip.device)

        with torch.no_grad():
            features = self.get_image_features(**inputs)
            features = F.normalize(features, p=2, dim=1)
            return features.float().cpu().numpy().tolist()

    def get_text_embedding(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of text strings.

        Args:
            texts: List of strings.

        Returns:
            List of embedding vectors (floats).
        """
        inputs = self.processor(text=texts, padding="max_length", return_tensors="pt").to(self.config.clip.device)

        with torch.no_grad():
            features = self.get_text_features(**inputs)
            features = F.normalize(features, p=2, dim=1)
            return features.float().cpu().numpy().tolist()
