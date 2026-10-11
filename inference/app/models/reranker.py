from typing import List, Tuple, Dict, Callable
import logging
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from .base import BaseModel, DEFAULT_TASK
from ..config import ModelType

logger = logging.getLogger(__name__)

class RerankerModel(BaseModel):
    PREFIX = "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n"
    SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    MAX_LENGTH = 8192

    def _load_model(self) -> None:
        model_id = "Qwen/Qwen3-Reranker-0.6B"
        logger.info(f"Loading Reranker model: {model_id}")

        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = AutoModelForCausalLM.from_pretrained(
            model_id,
            dtype=self.config.reranker.dtype,
            attn_implementation=self.config.reranker.attn_implementation
        ).to(self.config.reranker.device).eval()

        if self.config.reranker.compile:
            self.model = torch.compile(self.model)

        self.yes_id = self.tokenizer.convert_tokens_to_ids("yes")
        self.no_id = self.tokenizer.convert_tokens_to_ids("no")
        self.prefix_tokens = self.tokenizer.encode(self.PREFIX, add_special_tokens=False)
        self.suffix_tokens = self.tokenizer.encode(self.SUFFIX, add_special_tokens=False)

    def predict(self, items: List[Tuple[Tuple[str, str], str]]) -> List[float]:
        prompts = [f'<Instruct>: {desc or DEFAULT_TASK}\n<Query>: {q}\n<Document>: {d}' for (q, d), desc in items]

        # The body is truncated to leave room for the chat template around it.
        inputs = self.tokenizer(
            prompts,
            padding=False,
            truncation='longest_first',
            return_attention_mask=False,
            max_length=self.MAX_LENGTH - len(self.prefix_tokens) - len(self.suffix_tokens)
        )
        inputs['input_ids'] = [self.prefix_tokens + ids + self.suffix_tokens for ids in inputs['input_ids']]
        padded_inputs = self.tokenizer.pad(inputs, padding=True, return_tensors="pt").to(self.config.reranker.device)

        with torch.no_grad():
            logits = self.model(**padded_inputs).logits[:, -1, :]
            scores = torch.stack([logits[:, self.no_id], logits[:, self.yes_id]], dim=1)
            return torch.softmax(scores, dim=1)[:, 1].cpu().tolist()  # P("yes")

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        return {ModelType.RERANKER: self.predict}
