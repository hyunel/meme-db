from typing import List, Dict, Callable
import logging
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer
from .base import BaseModel, DEFAULT_TASK
from ..config import ModelType

logger = logging.getLogger(__name__)

class TextEmbeddingModel(BaseModel):
    def _load_model(self) -> None:
        model_id = 'Qwen/Qwen3-Embedding-0.6B'
        logger.info(f"Loading Text Embedding model: {model_id}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = AutoModel.from_pretrained(
            model_id,
            dtype=self.config.embedding.dtype,
            attn_implementation=self.config.embedding.attn_implementation
        ).to(self.config.embedding.device).eval()

        if self.config.embedding.compile:
            self.model = torch.compile(self.model)

    def get_embedding(self, items: List[tuple[str, str]]) -> List[List[float]]:
        texts = [f'Instruct: {desc or DEFAULT_TASK}\nQuery: {text}' for text, desc in items]
        inputs = self.tokenizer(texts, return_tensors='pt', padding=True, truncation=True).to(self.config.embedding.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            # Padding is on the left, so every sequence ends with its last real (EOS) token.
            embeddings = F.normalize(outputs.last_hidden_state[:, -1], p=2, dim=1)
            return embeddings.float().cpu().numpy().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        return {ModelType.TEXT_EMBEDDING: self.get_embedding}
