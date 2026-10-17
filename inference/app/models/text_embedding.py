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
        model_id = self.name = self.config.embedding.model
        logger.info(f"Loading Text Embedding model: {model_id} on {self.device}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = self.from_pretrained(AutoModel, model_id)
        self.dims = self.model.config.hidden_size  # The last hidden state is the embedding

        if self.gpu and self.gpu.compile:
            self.model = torch.compile(self.model)

    def tokenize(self, items: List[tuple[str, str]]) -> BatchEncoding:
        texts = [f'Instruct: {desc or DEFAULT_TASK}\nQuery: {text}' for text, desc in items]
        return self.tokenizer(texts, return_tensors='pt', padding=True, truncation=True, max_length=self.MAX_LENGTH)

    def get_embedding(self, inputs: BatchEncoding) -> List[List[float]]:
        with torch.no_grad():
            outputs = self.model(**inputs.to(self.device), use_cache=False)
            # Padding is on the left, so every sequence ends with its last real (EOS) token.
            embeddings = F.normalize(outputs.last_hidden_state[:, -1], p=2, dim=1)
            return embeddings.float().cpu().numpy().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Callable, Callable]]:
        return {ModelType.TEXT_EMBEDDING: (self.tokenize, self.get_embedding)}
