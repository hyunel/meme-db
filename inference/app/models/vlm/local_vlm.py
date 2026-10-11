from typing import List
import logging
import torch
import outlines
from PIL import Image
from .base import VLMModel
from ...config import ModelConfig

logger = logging.getLogger(__name__)


class LocalVLM(VLMModel):
    def __init__(self, config: ModelConfig):
        self.model = None
        self.processor = None
        super().__init__(config)

    def _load_model(self) -> None:
        from transformers import AutoProcessor, AutoModelForImageTextToText

        model_id = self.config.vlm.local.model

        logger.info(f"Loading local VLM: {model_id} on {self.config.vlm.device}")

        self.processor = AutoProcessor.from_pretrained(
            model_id,
            trust_remote_code=True
        )

        model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            dtype=self.config.vlm.dtype,
            attn_implementation=self.config.vlm.attn_implementation,
            trust_remote_code=True
        ).to(self.config.vlm.device).eval()

        if self.config.vlm.compile:
            model = torch.compile(model)

        self.model = outlines.from_transformers(model, self.processor)

    def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str]:
        if not items:
            return []

        messages = []
        for img, prompt in items:
            img.format = img.format or "PNG"  # outlines encodes images in their format, which in-memory frames lack
            messages.append(outlines.inputs.Chat([
                {"role": "user", "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image", "image": outlines.inputs.Image(img) }
                ]}
            ]))

        return self.model.generate_batch(
            messages,
            output_type=outlines.backends.get_cfg_logits_processor(
                outlines.backends.CFG_DEFAULT_BACKEND,
                self.model,
                outlines.grammars.json
            ),
            do_sample=False
        )
