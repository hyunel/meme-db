import asyncio
from typing import List
from PIL import Image
from io import BytesIO
from base64 import b64encode
from ..base import ModelMetric, NumberMetric
from .base import VLMModel


class OpenAIVLM(VLMModel):
    remote: bool = True

    def _load_model(self) -> None:
        from openai import AsyncOpenAI

        self.model_name = self.name = self.config.vlm.openai.model
        self.concurrency = self.config.vlm.openai.concurrency
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None
        self.rate_limits = 0
        self.client = AsyncOpenAI(
            api_key=self.config.vlm.openai.api_key,
            base_url=self.config.vlm.openai.base_url,
            max_retries=0,
        )

    async def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        from openai import RateLimitError

        captions = []
        for img, prompt in items:
            with BytesIO() as buffer:
                await asyncio.to_thread(img.save, buffer, format='PNG')
                img_b64 = b64encode(buffer.getvalue()).decode('utf-8')

            try:
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
            except RateLimitError:
                self.rate_limits += 1
                raise
            if usage := response.usage:
                if isinstance(usage.prompt_tokens, int) and usage.prompt_tokens >= 0:
                    self.input_tokens = (self.input_tokens or 0) + usage.prompt_tokens
                if isinstance(usage.completion_tokens, int) and usage.completion_tokens >= 0:
                    self.output_tokens = (self.output_tokens or 0) + usage.completion_tokens
            captions.append(response.choices[0].message.content)

        return captions

    async def metrics(self) -> list[ModelMetric]:
        return [
            NumberMetric(id='input_tokens_total', label_key='input_tokens_total', type='number', value=self.input_tokens, unit='tokens'),
            NumberMetric(id='output_tokens_total', label_key='output_tokens_total', type='number', value=self.output_tokens, unit='tokens'),
            NumberMetric(id='rate_limits_total', label_key='rate_limits_total', type='number', value=self.rate_limits, unit='requests'),
        ]
