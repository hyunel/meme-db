import logging
from abc import ABC, abstractmethod
from ctypes import CDLL, byref, c_uint32, c_void_p
from typing import Callable, NamedTuple

import torch

logger = logging.getLogger(__name__)


class GpuReading(NamedTuple):
    util: float | None  # %, None when unknown
    vram: int  # Bytes used


class Gpu(ABC):
    def __init__(self, device: torch.device, name: str, vram_total: int):
        self.id, self.name, self.vram_total = str(device), name, vram_total

    @abstractmethod
    def read(self) -> GpuReading:
        pass


class NvidiaGpu(Gpu):
    # The whole card, through NVML
    def __init__(self, device: torch.device):
        import pynvml
        pynvml.nvmlInit()
        self.nvml, self.handle = pynvml, pynvml.nvmlDeviceGetHandleByIndex(device.index)
        super().__init__(device, pynvml.nvmlDeviceGetName(self.handle), pynvml.nvmlDeviceGetMemoryInfo(self.handle).total)

    def read(self) -> GpuReading:
        return GpuReading(self.nvml.nvmlDeviceGetUtilizationRates(self.handle).gpu, self.nvml.nvmlDeviceGetMemoryInfo(self.handle).used)


class IntelGpu(Gpu):
    # Utilization is the whole GPU's busiest engine, from Level Zero Sysman, which ZES_ENABLE_SYSMAN turns on and CAP_PERFMON
    # lets read the engines; memory is this process's, as an integrated GPU's is the system's
    def __init__(self, device: torch.device):
        import pyzes as zes
        props = torch.xpu.get_device_properties(device)
        super().__init__(device, props.name, props.total_memory)
        self.zes, self.device = zes, device

        ze = CDLL('libze_loader.so.1')  # Level Zero's own API, whose device handles Sysman takes
        handle: c_void_p | None = None
        for driver in self._enum(ze.zeDriverGet, zes.zes_driver_handle_t):
            for h in self._enum(ze.zeDeviceGet, zes.zes_device_handle_t, driver):
                device_props = zes.zes_device_properties_t(stype=zes.ZES_STRUCTURE_TYPE_DEVICE_PROPERTIES)
                zes.zesDeviceGetProperties(h, byref(device_props))
                if bytes(device_props.core.uuid.id) == bytes(props.uuid.bytes):
                    handle = h

        compute = {zes.ZES_ENGINE_GROUP_COMPUTE_ALL, zes.ZES_ENGINE_GROUP_COMPUTE_SINGLE, zes.ZES_ENGINE_GROUP_RENDER_ALL,
                   zes.ZES_ENGINE_GROUP_RENDER_SINGLE, zes.ZES_ENGINE_GROUP_3D_RENDER_COMPUTE_ALL}  # Not video or copies
        self.engines: list[c_void_p] = []
        for engine in self._enum(zes.zesDeviceEnumEngineGroups, zes.zes_engine_handle_t, handle) if handle else []:
            engine_props = zes.zes_engine_properties_t(stype=zes.ZES_STRUCTURE_TYPE_ENGINE_PROPERTIES)
            zes.zesEngineGetProperties(engine, byref(engine_props))
            if engine_props.type in compute:
                self.engines.append(engine)
        if not self.engines:
            logger.info(f"GPU utilization unavailable for {device}: Level Zero Sysman needs ZES_ENABLE_SYSMAN=1 and CAP_PERFMON")
        self.last = self._activity()

    @staticmethod
    def _enum(func: Callable[..., int], handle_type: type[c_void_p], *args) -> list[c_void_p]:
        # Level Zero lists in two calls: the count, then the handles
        count = c_uint32(0)
        func(*args, byref(count), None)
        handles = (handle_type * count.value)()
        func(*args, byref(count), handles)
        return list(handles)

    def _activity(self) -> list[tuple[int, int]]:  # Each engine's busy time and timestamp, in µs
        stats = [self.zes.zes_engine_stats_t() for _ in self.engines]
        for engine, s in zip(self.engines, stats):
            self.zes.zesEngineGetActivity(engine, byref(s))
        return [(s.activeTime, s.timestamp) for s in stats]

    def read(self) -> GpuReading:
        last, self.last = self.last, self._activity()  # Since the last reading
        busy = [(a1 - a0) / (t1 - t0) for (a0, t0), (a1, t1) in zip(last, self.last) if t1 > t0]
        return GpuReading(min(100, max(busy) * 100) if busy else None, torch.xpu.memory_reserved(self.device))


READERS: dict[str, type[Gpu]] = {'cuda': NvidiaGpu, 'xpu': IntelGpu}


def open_gpus(devices: list[torch.device]) -> list[Gpu]:
    gpus = []
    for device in devices:
        if device.type in READERS:
            try:
                gpus.append(READERS[device.type](device))
            except Exception as e:  # No NVIDIA driver, say
                logger.info(f"GPU metrics unavailable for {device}: {e}")
    return gpus
