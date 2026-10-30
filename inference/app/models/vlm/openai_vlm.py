import asyncio
from typing import List
from PIL import Image
from io import BytesIO
from base64 import b64encode
from .base import VLMModel


class OpenAIVLM(VLMModel):
    remote: bool = True

    def _load_model(self) -> None:
        from openai import AsyncOpenAI

        self.model_name = self.name = self.config.vlm.openai.model
        self.concurrency = self.config.vlm.openai.concurrency
        self.client = AsyncOpenAI(
            api_key=self.config.vlm.openai.api_key,
            base_url=self.config.vlm.openai.base_url,
            max_retries=0,
        )

    async def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        captions = []
        for img, prompt in items:
            with BytesIO() as buffer:
                await asyncio.to_thread(img.save, buffer, format='PNG')
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
            captions.append(response.choices[0].message.content)

        return captions
