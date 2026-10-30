from abc import ABC, abstractmethod
from typing import Dict, Callable, Literal, NotRequired, Optional, Tuple, TypedDict
import torch
from ..config import LocalModelConfig, ModelConfig, ModelType

DEFAULT_TASK = "Given a web search query, retrieve relevant passages that answer the query"
# Batches of text pad to a multiple of this many tokens. Intel GPUs compile kernels for each input shape, a second
# or more apiece, so lengths in steps keep the shapes few; the padding is masked and changes no output.
PAD_MULTIPLE = 8


def resolve_device(name: str) -> torch.device:
    if name == 'auto':  # The GPU this torch build runs on (CUDA, Intel XPU, Apple MPS), if the machine has one
        name = torch.accelerator.current_accelerator(check_available=True) or 'cpu'
    device = torch.device(name)
    # Models on cuda and cuda:0 share that GPU
    return torch.device(device.type, torch.accelerator.current_device_index()) if device.type != 'cpu' and device.index is None else device


# A model turning requests away for now, for their callers to retry later without counting an attempt
class Busy(Exception):
    pass


class ModelMetric(TypedDict):
    id: str
    label_key: str
    type: Literal['number', 'ratio', 'status', 'timestamp']
    value: float | str | None  # Ratios are 0–1; timestamps are epoch milliseconds
    group: NotRequired[str]
    unit: NotRequired[str]
    level: NotRequired[Literal['ok', 'warn', 'danger']]


class BaseModel(ABC):
    remote: bool = False  # Served by an API instead of run here
    name: str = ''  # The loaded model, for monitoring
    dims: Optional[int] = None  # Of the embeddings it makes, which the server stores
    batch_size: int = 1  # Requests per call of run
    batch_latency: float = 0.0  # Seconds a batch waits to fill
    concurrency: int = 1  # Calls at once, for a remote model; a local model's follow its device

    def __init__(self, config: ModelConfig, settings: Optional[LocalModelConfig]):
        self.config = config
        self.device = resolve_device(settings.device) if settings else None  # None for an API
        # How it runs where it is, on a GPU or the CPU
        self.gpu = settings.gpu if self.device and self.device.type != 'cpu' else None
        self.cpu = settings.cpu if self.device and self.device.type == 'cpu' else None
        if self.gpu:  # A GPU runs requests in batches
            self.batch_size, self.batch_latency = self.gpu.batch_size, self.gpu.batch_latency
        self._load_model()

    def from_pretrained(self, model_class, model_id: str, **kwargs):
        # A CPU runs float32: half precision is several times slower on CPUs without AMX
        options = {'dtype': self.gpu.dtype, 'attn_implementation': self.gpu.attn_implementation} if self.gpu else {'dtype': torch.float32}
        return model_class.from_pretrained(model_id, **options, **kwargs).to(self.device).eval()

    @abstractmethod
    def _load_model(self) -> None:
        pass

    async def metrics(self) -> list[ModelMetric] | None:
        return None

    @property
    def inference_methods(self) -> Dict[ModelType, Tuple[Optional[Callable], Callable]]:
        # (prepare, run): prepare readies inputs (tokenizing, preprocessing) before run takes the device.
        return {}
