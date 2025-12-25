from typing import List, Dict, Callable
import logging
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer
from .base import BaseModel
from ..config import ModelType

logger = logging.getLogger(__name__)

class TextEmbeddingModel(BaseModel):
    """
    Text Embedding Model wrapper using Qwen-Embedding.
    """

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

    def _last_token_pool(self, last_hidden_states: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        """
        Extracts embeddings from the last valid token (EOS).

        Args:
            last_hidden_states: Tensor of shape (batch, seq_len, hidden_dim).
            attention_mask: Tensor of shape (batch, seq_len).

        Returns:
            Tensor of shape (batch, hidden_dim).
        """
        left_padding = (attention_mask[:, -1].sum() == attention_mask.shape[0])
        if left_padding:
            return last_hidden_states[:, -1]
        else:
            sequence_lengths = attention_mask.sum(dim=1) - 1
            batch_size = last_hidden_states.shape[0]
            return last_hidden_states[torch.arange(batch_size, device=self.config.embedding.device), sequence_lengths]

    def get_embedding(self, items: List[tuple[str, str]]) -> List[List[float]]:
        """
        Generate normalized embeddings for text.

        Args:
            items: List of (text, task_description) tuples.

        Returns:
            List of normalized embedding vectors.
        """
        default_description = "Given a web search query, retrieve relevant passages that answer the query"

        formatted_texts = []
        for text, desc in items:
            desc = desc or default_description
            if desc:
                formatted_texts.append(f'Instruct: {desc}\nQuery: {text}')
            else:
                formatted_texts.append(text)

        texts = formatted_texts

        inputs = self.tokenizer(texts, return_tensors='pt', padding=True, truncation=True).to(self.config.embedding.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            embeddings = self._last_token_pool(outputs.last_hidden_state, inputs['attention_mask'])
            embeddings = F.normalize(embeddings, p=2, dim=1)
            return embeddings.float().cpu().numpy().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Callable]:
        return {ModelType.TEXT_EMBEDDING: self.get_embedding}
