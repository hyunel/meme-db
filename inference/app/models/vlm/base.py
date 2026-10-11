from typing import List, Dict, Callable
from abc import abstractmethod
from PIL import Image
from ..base import BaseModel
from ...config import ModelType

class VLMModel(BaseModel):
    @abstractmethod
    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        return {ModelType.VLM: self.generate_caption}
