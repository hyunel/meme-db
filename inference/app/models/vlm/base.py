from typing import List, Dict, Callable, Optional, Tuple
from abc import abstractmethod
from PIL import Image
from ..base import BaseModel
from ...config import ModelType

class VLMModel(BaseModel):
    @abstractmethod
    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Optional[Callable], Callable]]:
        return {ModelType.VLM: (None, self.generate_caption)}
