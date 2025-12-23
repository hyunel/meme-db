from .base import VLMModel
from .openai_vlm import OpenAIVLM
from .local_vlm import LocalVLM
from ...config import ModelConfig
from typing import Type

def get_vlm_class(config: ModelConfig) -> Type[VLMModel]:
    clazz = {
        "openai": OpenAIVLM,
        "local": LocalVLM
    }.get(config.vlm.provider)

    if not clazz:
        raise ValueError(f"Unsupported VLM provider: {config.vlm.provider}")

    return clazz
