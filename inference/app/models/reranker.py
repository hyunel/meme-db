from typing import List, Tuple
import logging
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from .base import BaseModel

logger = logging.getLogger(__name__)

class RerankerModel(BaseModel):
    """
    Reranker Model wrapper using Qwen-Reranker.
    Calculates relevance probability between query and document.
    """

    # Constants for template
    PREFIX = "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n"
    SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"

    def _load_model(self) -> None:
        model_id = "Qwen/Qwen3-Reranker-0.6B"
        logger.info(f"Loading Reranker model: {model_id}")

        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = AutoModelForCausalLM.from_pretrained(
            model_id,
            dtype=self.config.reranker.dtype,
            attn_implementation=self.config.reranker.attn_implementation
        ).to(self.config.device).eval()

        if self.config.reranker.do_compile:
            self.model = torch.compile(self.model)

        # Cache IDs and Template Tokens
        self.yes_id = self.tokenizer.convert_tokens_to_ids("yes")
        self.no_id = self.tokenizer.convert_tokens_to_ids("no")
        self.prefix_tokens = self.tokenizer.encode(self.PREFIX, add_special_tokens=False)
        self.suffix_tokens = self.tokenizer.encode(self.SUFFIX, add_special_tokens=False)

    def predict(self, pairs: List[Tuple[str, str]], task_description: str = "") -> List[float]:
        """
        Rerank a list of (query, document) pairs.

        Args:
            pairs: List of (query_str, document_str) tuples.
            task_description: Optional instruction.

        Returns:
            List of relevance scores (probabilities of 'yes').
        """
        if not task_description:
            task_description = "Given a web search query, retrieve relevant passages that answer the query"

        prompts = [
            f'<Instruct>: {task_description}\n<Query>: {q}\n<Document>: {d}'
            for q, d in pairs
        ]

        max_length = 8192
        # Tokenize body first
        inputs = self.tokenizer(
            prompts,
            padding=False,
            truncation='longest_first',
            return_attention_mask=False,
            max_length=max_length - len(self.prefix_tokens) - len(self.suffix_tokens)
        )

        # Prepend/Append system tokens
        for i, ele in enumerate(inputs['input_ids']):
            inputs['input_ids'][i] = self.prefix_tokens + ele + self.suffix_tokens

        # Pad final inputs
        padded_inputs = self.tokenizer.pad(inputs, padding=True, return_tensors="pt").to(self.config.device)

        with torch.no_grad():
            outputs = self.model(**padded_inputs)
            logits = outputs.logits[:, -1, :]
            scores = torch.stack([logits[:, self.no_id], logits[:, self.yes_id]], dim=1)
            log_scores = torch.nn.functional.log_softmax(scores, dim=1)
            # Return probability of 'yes' class (index 1)
            return log_scores[:, 1].exp().cpu().tolist()
