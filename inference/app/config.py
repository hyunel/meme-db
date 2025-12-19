from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal, Union, Any
import torch
import yaml
import os
import re

class ModelCommon(BaseModel):
    dtype: Optional[str] = None
    attn_implementation: str = "sdpa"
    do_compile: bool = False

class OpenAIConfig(BaseModel):
    model: str = "gpt-4o"
    api_key: Optional[str] = None
    base_url: Optional[str] = None

class LocalVLMConfig(BaseModel):
    model: str = "Qwen/Qwen3-VL-2B-Instruct"

class VLMConfig(ModelCommon):
    provider: Literal["openai", "local"] = "openai"
    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    local: LocalVLMConfig = Field(default_factory=LocalVLMConfig)

class CLIPConfig(ModelCommon):
    pass

class EmbeddingConfig(ModelCommon):
    pass

class RerankerConfig(ModelCommon):
    pass

class ModelConfig(BaseModel):
    device: Optional[Any] = None

    vlm: VLMConfig = Field(default_factory=VLMConfig)
    clip: CLIPConfig = Field(default_factory=CLIPConfig)
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    reranker: RerankerConfig = Field(default_factory=RerankerConfig)

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "ModelConfig":
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
