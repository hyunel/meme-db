from typing import List
from abc import abstractmethod
from PIL import Image
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
    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        """
        Generate captions for images using VLM.

        Args:
            items: List of (image, prompt) tuples.
        """
        pass
