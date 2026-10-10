from typing import List
import logging
import torch
import outlines
from PIL import Image
from .base import VLMModel
from ...config import ModelConfig

logger = logging.getLogger(__name__)


def as_input_image(img: Image.Image) -> outlines.inputs.Image:
    """Wraps a frame for outlines, which encodes images in their format; frames decoded or
    stitched in memory have none, so they are sent as PNG."""
    img.format = img.format or "PNG"
    return outlines.inputs.Image(img)


class LocalVLM(VLMModel):
    """
    Local transformers-based VLM implementation.
    """

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

        # Prepare batch of messages
        messages = []
        for img, prompt in items:
            messages.append(outlines.inputs.Chat([
                {"role": "user", "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image", "image": as_input_image(img) }
                ]}
            ]))

        # Batch process all images at once
        return self.model.generate_batch(
            messages,
            output_type=outlines.backends.get_cfg_logits_processor(
                outlines.backends.CFG_DEFAULT_BACKEND,
                self.model,
                outlines.grammars.json
            ),
            do_sample=False
        )
