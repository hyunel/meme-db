from typing import List, Dict, Callable, Tuple
import logging
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer, BatchEncoding
from .base import BaseModel, DEFAULT_TASK
from ..config import ModelType

logger = logging.getLogger(__name__)

class TextEmbeddingModel(BaseModel):
    MAX_LENGTH = 1024  # Captions and queries run a few hundred tokens; the cap bounds a batch's memory

    def _load_model(self) -> None:
        model_id = self.name = 'Qwen/Qwen3-Embedding-0.6B'
        logger.info(f"Loading Text Embedding model: {model_id}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = AutoModel.from_pretrained(
            model_id,
            dtype=self.config.embedding.dtype,
            attn_implementation=self.config.embedding.attn_implementation
        ).to(self.config.embedding.device).eval()

        if self.config.embedding.compile:
            self.model = torch.compile(self.model)

    def tokenize(self, items: List[tuple[str, str]]) -> BatchEncoding:
        texts = [f'Instruct: {desc or DEFAULT_TASK}\nQuery: {text}' for text, desc in items]
        return self.tokenizer(texts, return_tensors='pt', padding=True, truncation=True, max_length=self.MAX_LENGTH)

    def get_embedding(self, inputs: BatchEncoding) -> List[List[float]]:
        with torch.no_grad():
            outputs = self.model(**inputs.to(self.config.embedding.device), use_cache=False)
            # Padding is on the left, so every sequence ends with its last real (EOS) token.
            embeddings = F.normalize(outputs.last_hidden_state[:, -1], p=2, dim=1)
            return embeddings.float().cpu().numpy().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Callable, Callable]]:
        return {ModelType.TEXT_EMBEDDING: (self.tokenize, self.get_embedding)}
