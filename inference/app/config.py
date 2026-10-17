import yaml
import os
import re
from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, Literal

class ModelType(str, Enum):
    CLIP = "clip"
    CLIP_IMAGE = "clip_image"
    CLIP_TEXT = "clip_text"
    TEXT_EMBEDDING = "text_embedding"
    RERANKER = "reranker"
    VLM = "vlm"

class GPUConfig(BaseModel):
    # Models on one GPU take turns, a batch at a time
    batch_size: int = 32
    max_latency: float = 0.1  # Seconds a batch waits to fill
    dtype: Optional[str] = None
    attn_implementation: str = "sdpa"
    compile: bool = False

class CPUConfig(BaseModel):
    # A model on the CPU runs in float32, requests side by side, one thread each
    threads: Optional[int] = None  # Requests run at once; by default the models on the CPU split its threads

class LocalModelConfig(BaseModel):
    device: str = "auto"  # The first GPU, or the CPU without one; or cpu, cuda:1, mps, ...
    gpu: GPUConfig = Field(default_factory=GPUConfig)
    cpu: CPUConfig = Field(default_factory=CPUConfig)

class CLIPConfig(LocalModelConfig):
    model: str = "google/siglip2-base-patch16-224"

class EmbeddingConfig(LocalModelConfig):
    model: str = "Qwen/Qwen3-Embedding-0.6B"

class RerankerConfig(LocalModelConfig):
    model: str = "Qwen/Qwen3-Reranker-0.6B"

class OpenAIConfig(BaseModel):
    model: str = "gpt-4o"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    max_retries: int = 3
    concurrency: int = 8  # Requests in flight

class LocalVLMConfig(LocalModelConfig):
    model: str = "Qwen/Qwen3-VL-2B-Instruct"

class VLMConfig(BaseModel):
    provider: Literal["openai", "local"] = "openai"
    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    local: LocalVLMConfig = Field(default_factory=LocalVLMConfig)

class ModelConfig(BaseModel):
    clip: CLIPConfig = Field(default_factory=CLIPConfig)
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    reranker: RerankerConfig = Field(default_factory=RerankerConfig)
    vlm: VLMConfig = Field(default_factory=VLMConfig)

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "ModelConfig":
        if not os.path.exists(yaml_path):
            return cls()

        with open(yaml_path) as f:
            # ${VAR} placeholders come from the environment.
            content = re.sub(r'\$\{([^}]+)\}', lambda m: os.environ.get(m.group(1), m.group(0)), f.read())

        return cls(**(yaml.safe_load(content) or {}))
