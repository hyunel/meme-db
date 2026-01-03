from typing import List
import logging
import asyncio
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
        """Initialize OpenAI-compatible async client."""
        from openai import AsyncOpenAI

        self.model_name = self.config.vlm.openai.model
        self.client = AsyncOpenAI(
            api_key=self.config.vlm.openai.api_key,
            base_url=self.config.vlm.openai.base_url,
            max_retries=self.config.vlm.openai.max_retries,
        )

    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        if not items:
            return []

        async def analyze_single_image(img: Image.Image, prompt: str) -> str:
            with BytesIO() as buffer:
                img.save(buffer, format='PNG')
                img_b64 = b64encode(buffer.getvalue()).decode('utf-8')

            response = await self.client.chat.completions.create(
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

        async def analyze_all():
            tasks = [analyze_single_image(img, prompt) for img, prompt in items]
            return await asyncio.gather(*tasks)

        loop = asyncio.new_event_loop()
        try:
            results = loop.run_until_complete(analyze_all())
        finally:
            loop.close()

        return results
