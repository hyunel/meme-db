from typing import List
import logging
from PIL import Image
from io import BytesIO
from base64 import b64encode
from .base import VLMModel
from ...config import ModelConfig

logger = logging.getLogger(__name__)


class OpenAIVLM(VLMModel):
    """
    OpenAI-compatible API VLM implementation.
    """

    is_gpu: bool = False

    def __init__(self, config: ModelConfig):
        self.client = None
        super().__init__(config)

    def _load_model(self) -> None:
        """Initialize the OpenAI-compatible client; it is thread-safe, and calls run on executor threads."""
        from openai import OpenAI

        self.model_name = self.config.vlm.openai.model
        self.client = OpenAI(
            api_key=self.config.vlm.openai.api_key,
            base_url=self.config.vlm.openai.base_url,
            max_retries=self.config.vlm.openai.max_retries,
        )

    def _caption(self, img: Image.Image, prompt: str) -> str:
        with BytesIO() as buffer:
            img.save(buffer, format='PNG')
            img_b64 = b64encode(buffer.getvalue()).decode('utf-8')

        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{img_b64}"}
                    }
                ]}
            ],
            temperature=0,
            top_p=1,
            response_format={"type": "json_object"}
        )
        return response.choices[0].message.content

    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        # The scheduler submits one item at a time; concurrency comes from its executor threads.
        return [self._caption(img, prompt) for img, prompt in items]
