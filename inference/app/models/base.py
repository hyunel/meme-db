from abc import ABC, abstractmethod
from typing import Dict, Callable, Optional, Tuple
import torch
from ..config import LocalModelConfig, ModelConfig, ModelType

DEFAULT_TASK = "Given a web search query, retrieve relevant passages that answer the query"


def resolve_device(name: str) -> torch.device:
    if name == 'auto':  # The GPU this torch build runs on (CUDA, Intel XPU, Apple MPS), if the machine has one
        name = torch.accelerator.current_accelerator(check_available=True) or 'cpu'
    device = torch.device(name)
    # Models on cuda and cuda:0 share that GPU
    return torch.device(device.type, torch.accelerator.current_device_index()) if device.type != 'cpu' and device.index is None else device


class BaseModel(ABC):
    remote: bool = False  # Served by an API instead of run here
    name: str = ''  # The loaded model, for monitoring
    dims: Optional[int] = None  # Of the embeddings it makes, which the server stores

    def __init__(self, config: ModelConfig, settings: Optional[LocalModelConfig]):
        self.config = config
        self.device = resolve_device(settings.device) if settings else None  # None for an API
        # How it runs where it is, on a GPU or the CPU
        self.gpu = settings.gpu if self.device and self.device.type != 'cpu' else None
        self.cpu = settings.cpu if self.device and self.device.type == 'cpu' else None
        self._load_model()

    def from_pretrained(self, model_class, model_id: str, **kwargs):
        # A CPU runs float32: half precision is several times slower on CPUs without AMX
        options = {'dtype': self.gpu.dtype, 'attn_implementation': self.gpu.attn_implementation} if self.gpu else {'dtype': torch.float32}
        return model_class.from_pretrained(model_id, **options, **kwargs).to(self.device).eval()

    @abstractmethod
    def _load_model(self) -> None:
        pass

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Optional[Callable], Callable]]:
        # (prepare, run): prepare readies inputs (tokenizing, preprocessing) before run takes the device.
        return {}
