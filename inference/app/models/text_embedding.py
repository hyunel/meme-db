from typing import List, Dict
import logging
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer
from .base import BaseModel

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
        ).to(self.config.device).eval()

        if self.config.embedding.do_compile:
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
            return last_hidden_states[torch.arange(batch_size, device=self.config.device), sequence_lengths]

    def get_embedding(self, texts: List[str], task_description: str = "") -> List[List[float]]:
        """
        Generate normalized embeddings for text.

        Args:
            texts: List of strings.
            task_description: Optional instruction.

        Returns:
            List of normalized embedding vectors.
        """
        if not task_description:
            task_description = "Given a web search query, retrieve relevant passages that answer the query"

        # Format with instruction
        texts = [
            f'Instruct: {task_description}\nQuery: {text}'
            if task_description else text for text in texts
        ]

        inputs = self.tokenizer(texts, return_tensors='pt', padding=True, truncation=True).to(self.config.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            embeddings = self._last_token_pool(outputs.last_hidden_state, inputs['attention_mask'])
            embeddings = F.normalize(embeddings, p=2, dim=1)
            return embeddings.float().cpu().numpy().tolist()
