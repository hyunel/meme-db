from typing import List, Dict, Any
import logging
import torch
from PIL import Image
from .base import VLMModel, VLM_PROMPT
from ...config import ModelConfig

logger = logging.getLogger(__name__)


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

        logger.info(f"Loading local VLM: {model_id} on {self.config.device}")

        self.model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            dtype=self.config.vlm.dtype,
            attn_implementation=self.config.vlm.attn_implementation,
            trust_remote_code=True
        ).to(self.config.device).eval()

        self.processor = AutoProcessor.from_pretrained(
            model_id,
            trust_remote_code=True
        )

        if self.config.vlm.do_compile:
            self.model = torch.compile(self.model)

    def analyze_images(self, images: List[Image.Image]) -> List[Dict[str, Any]]:
        if not images:
            return []

        # Prepare batch of messages
        texts = []
        for img in images:
            messages = [
                {
                    "role": "system",
                    "content": VLM_PROMPT
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": img}
                    ]
                }
            ]
            text = self.processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            texts.append(text)

        # Batch process all images at once
        inputs = self.processor(
            text=texts,
            images=images,
            return_tensors="pt",
            padding=True
        ).to(self.config.device)

        # Generate for all images in batch
        with torch.no_grad():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=2048,
                temperature=0.0,
                do_sample=False
            )

        # Decode all outputs
        generated_texts = self.processor.batch_decode(
            output_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False
        )

        # Extract JSON from each response
        results = []
        for generated_text in generated_texts:
            try:
                result = self._extract_json(generated_text)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to parse VLM output: {e}")
                results.append(self._get_empty_result())

        return results
