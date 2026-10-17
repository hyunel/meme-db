from typing import List, Tuple, Dict, Callable, Type
import logging
import torch
from transformers import AutoConfig, AutoTokenizer, AutoModelForCausalLM, AutoModelForSequenceClassification, BatchEncoding, DynamicCache
from .base import BaseModel, DEFAULT_TASK
from ..config import ModelConfig, ModelType

logger = logging.getLogger(__name__)


class SharedPrefixCache(DynamicCache):
    # Once frozen, puts the prefix it holds ahead of every row without storing the rows' own keys and values.
    frozen = False

    def update(self, key_states, value_states, layer_idx, cache_kwargs=None):
        if not self.frozen:
            return super().update(key_states, value_states, layer_idx, cache_kwargs)
        layer, rows = self.layers[layer_idx], key_states.shape[0]
        return (torch.cat([layer.keys.expand(rows, -1, -1, -1), key_states], dim=-2),
                torch.cat([layer.values.expand(rows, -1, -1, -1), value_states], dim=-2))


class LMReranker(BaseModel):
    # Qwen3-Reranker: a language model answers whether the document meets the query, scored by P("yes")
    PREFIX = "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n"
    SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    MAX_LENGTH = 1024  # Documents are captions of a few hundred tokens; the cap bounds a batch's memory

    def _load_model(self) -> None:
        model_id = self.name = self.config.reranker.model
        logger.info(f"Loading Reranker model: {model_id} on {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side='left')
        self.model = self.from_pretrained(AutoModelForCausalLM, model_id)

        if self.gpu and self.gpu.compile:
            self.model = torch.compile(self.model)

        self.yes_id = self.tokenizer.convert_tokens_to_ids("yes")
        self.no_id = self.tokenizer.convert_tokens_to_ids("no")
        self.prefix_tokens = self.tokenizer.encode(self.PREFIX, add_special_tokens=False)
        self.suffix_tokens = self.tokenizer.encode(self.SUFFIX, add_special_tokens=False)

    def tokenize(self, items: List[Tuple[Tuple[str, str], str]]) -> List[Tuple[Tuple[int, ...], List[int], BatchEncoding]]:
        # A search page reranks its documents against one query, so the prompt up to the document runs once for them.
        groups: Dict[Tuple[str, str], List[Tuple[int, str]]] = {}
        for i, ((query, doc), desc) in enumerate(items):
            groups.setdefault((query, desc), []).append((i, doc))

        batches = []
        for (query, desc), members in groups.items():
            indices, docs = zip(*members)
            # Split before the document's leading space, the prompt tokenizes as it would whole.
            head = self.prefix_tokens + self.tokenizer.encode(f'<Instruct>: {desc or DEFAULT_TASK}\n<Query>: {query}\n<Document>:', add_special_tokens=False)
            ids = self.tokenizer(
                [' ' + doc for doc in docs],
                add_special_tokens=False,
                truncation=True,
                max_length=self.MAX_LENGTH - len(head) - len(self.suffix_tokens),
            )['input_ids']
            batches.append((indices, head, self.tokenizer.pad({'input_ids': [x + self.suffix_tokens for x in ids]}, return_tensors='pt')))
        return batches

    def predict(self, batches: List[Tuple[Tuple[int, ...], List[int], BatchEncoding]]) -> List[float]:
        device = self.device
        scores = {}
        with torch.no_grad():
            for indices, head, docs in batches:
                cache = SharedPrefixCache()
                self.model(torch.tensor([head], device=device), past_key_values=cache, use_cache=True, logits_to_keep=1)
                cache.frozen = True

                mask = docs['attention_mask'].to(device)
                logits = self.model(
                    input_ids=docs['input_ids'].to(device),
                    attention_mask=torch.cat([mask.new_ones(len(indices), len(head)), mask], dim=1),
                    # Left padding sits between the prefix and each document, so positions skip it.
                    position_ids=len(head) + (mask.cumsum(1) - 1).clamp(min=0),
                    past_key_values=cache,
                    # Only the last position is scored; vocabulary logits for every position would take gigabytes per batch.
                    logits_to_keep=1,
                ).logits[:, -1, :]
                yes = torch.softmax(torch.stack([logits[:, self.no_id], logits[:, self.yes_id]], dim=1), dim=1)[:, 1]
                scores.update(zip(indices, yes.cpu().tolist()))  # P("yes")
        return [scores[i] for i in range(len(scores))]

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Callable, Callable]]:
        return {ModelType.RERANKER: (self.tokenize, self.predict)}


class CrossEncoderReranker(BaseModel):
    MAX_LENGTH = 512  # Query and document together; documents are captions of a few hundred tokens

    def _load_model(self) -> None:
        model_id = self.name = self.config.reranker.model
        logger.info(f"Loading Reranker model: {model_id} on {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(model_id)
        self.model = self.from_pretrained(AutoModelForSequenceClassification, model_id)

        if self.gpu and self.gpu.compile:
            self.model = torch.compile(self.model)

    def tokenize(self, items: List[Tuple[Tuple[str, str], str]]) -> BatchEncoding:
        queries, docs = zip(*(pair for pair, _ in items))  # Cross-encoders take no task description
        return self.tokenizer(list(queries), list(docs), padding=True, truncation=True, max_length=self.MAX_LENGTH, return_tensors='pt')

    def predict(self, inputs: BatchEncoding) -> List[float]:
        with torch.no_grad():
            logits = self.model(**inputs.to(self.device)).logits[:, 0]  # One relevance logit per pair
            return logits.sigmoid().float().cpu().tolist()

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Callable, Callable]]:
        return {ModelType.RERANKER: (self.tokenize, self.predict)}


def get_reranker_class(config: ModelConfig) -> Type[BaseModel]:
    architectures = AutoConfig.from_pretrained(config.reranker.model).architectures or []
    return CrossEncoderReranker if any(a.endswith('ForSequenceClassification') for a in architectures) else LMReranker
