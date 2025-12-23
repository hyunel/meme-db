import yaml
import os
import re
from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, Literal, Any, Dict

class ModelType(str, Enum):
    """Enum for different model types."""
    CLIP = "clip"
    TEXT_EMBEDDING = "text_embedding"
    RERANKER = "reranker"
    VLM = "vlm"

class BaseModelConfig(BaseModel):
    """Unified configuration for both model parameters and task execution settings."""
    # Model parameters
    device: Optional[Any] = None
    dtype: Optional[str] = None
    attn_implementation: str = "sdpa"
    compile: bool = False

    # Task execution settings
    batch_size: int = 32
    max_latency: float = 0.1  # seconds
    concurrency: int = 8

class OpenAIConfig(BaseModel):
    model: str = "gpt-4o"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    max_retries: int = 3

class LocalVLMConfig(BaseModel):
    model: str = "Qwen/Qwen3-VL-2B-Instruct"

class VLMConfig(BaseModelConfig):
    provider: Literal["openai", "local"] = "openai"
    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    local: LocalVLMConfig = Field(default_factory=LocalVLMConfig)

class CLIPConfig(BaseModelConfig):
    pass

class EmbeddingConfig(BaseModelConfig):
    pass

class RerankerConfig(BaseModelConfig):
    pass

class ModelConfig(BaseModel):
    concurrency: int = 16

    vlm: VLMConfig = Field(default_factory=VLMConfig)
    clip: CLIPConfig = Field(default_factory=CLIPConfig)
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    reranker: RerankerConfig = Field(default_factory=RerankerConfig)

    def get_model_configs(self) -> Dict[ModelType, BaseModelConfig]:
        return {
            ModelType.VLM: self.vlm,
            ModelType.CLIP: self.clip,
            ModelType.TEXT_EMBEDDING: self.embedding,
            ModelType.RERANKER: self.reranker,
        }

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "ModelConfig":
        if not os.path.exists(yaml_path):
            return cls()

        with open(yaml_path, 'r') as f:
            yaml_content = f.read()

        # Substitute environment variables in YAML (${VAR_NAME} format)
        def replace_env_var(match):
            var_name = match.group(1)
            return os.environ.get(var_name, match.group(0))

        yaml_content = re.sub(r'\$\{([^}]+)\}', replace_env_var, yaml_content)

        # Load YAML
        config_dict = yaml.safe_load(yaml_content) or {}

        # Create config from dict
        return cls(**config_dict)
