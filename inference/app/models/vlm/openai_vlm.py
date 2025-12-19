from typing import List, Dict, Any
import logging
import json
import asyncio
from PIL import Image
from io import BytesIO
from base64 import b64encode
from .base import VLMModel, VLM_PROMPT
from ...config import ModelConfig

logger = logging.getLogger(__name__)


class OpenAIVLM(VLMModel):
    """
    OpenAI-compatible API VLM implementation.
    """

    def __init__(self, config: ModelConfig):
        self.client = None
        super().__init__(config)

    def _load_model(self) -> None:
        """Initialize OpenAI-compatible async client."""
        from openai import AsyncOpenAI

        self.model_name = self.config.vlm.openai.model
        self.client = AsyncOpenAI(
            api_key=self.config.vlm.openai.api_key,
            base_url=self.config.vlm.openai.base_url
        )

    def analyze_images(self, images: List[Image.Image]) -> List[Dict[str, Any]]:
        if not images:
            return []

        async def analyze_single_image(img: Image.Image) -> Dict[str, Any]:
            with BytesIO() as buffer:
                img.save(buffer, format='PNG')
                img_b64 = b64encode(buffer.getvalue()).decode('utf-8')

            image_content = {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{img_b64}"}
            }

            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": VLM_PROMPT},
                    {"role": "user", "content": [image_content]}
                ],
                temperature=0,
                max_tokens=4096,
                response_format={"type": "json_object"}
            )

            content = response.choices[0].message.content
            result = json.loads(content)
            return result

        async def analyze_all():
            tasks = [analyze_single_image(img) for img in images]
            return await asyncio.gather(*tasks)

        loop = asyncio.new_event_loop()
        try:
            results = loop.run_until_complete(analyze_all())
        finally:
            loop.close()

        return results
