from typing import List
import logging
import torch
import outlines
from PIL import Image
from .base import VLMModel

logger = logging.getLogger(__name__)


class LocalVLM(VLMModel):
    MAX_PIXELS = 1280 * 32 * 32  # Per image: Qwen3-VL makes a token of each 32x32 patch, so a screenshot could take thousands
    MAX_NEW_TOKENS = 1024  # A caption runs a few hundred; transformers would otherwise stop after 20

    def _load_model(self) -> None:
        from transformers import AutoProcessor, AutoModelForImageTextToText

        model_id = self.name = self.config.vlm.local.model

        logger.info(f"Loading local VLM: {model_id} on {self.device}")

        self.processor = AutoProcessor.from_pretrained(
            model_id,
            trust_remote_code=True
        )
        self.processor.image_processor.size["longest_edge"] = self.MAX_PIXELS  # Qwen-VL reads its pixel cap from here

        model = self.from_pretrained(AutoModelForImageTextToText, model_id, trust_remote_code=True)

        if self.gpu and self.gpu.compile:
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
            do_sample=False,
            max_new_tokens=self.MAX_NEW_TOKENS
        )
