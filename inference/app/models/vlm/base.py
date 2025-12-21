from typing import List, Dict, Any
from abc import abstractmethod
from PIL import Image
import json
import re
from ..base import BaseModel

class VLMModel(BaseModel):
    """
    Abstract base class for Vision Language Models.
    """

    @abstractmethod
    def _load_model(self) -> None:
        """Load the VLM model."""
        pass

    @abstractmethod
    def generate_caption(self, prompt: str, images: List[Image.Image]) -> List[str]:
        """
        Generate captions for images using VLM.
        """
        pass
