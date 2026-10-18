import grpc
import json
import psutil
import torch
import logging
import asyncio
from .manager import ModelManager
from .models.base import BaseModel
from .config import ModelType, ModelConfig
from .pb import inference_pb2, inference_pb2_grpc
from .utils import load_image_from_bytes, draw_stitch
from .schedulers import BatchScheduler, SimpleScheduler, ResourceManager
from .metrics import Monitor

logger = logging.getLogger(__name__)


class InferenceService(inference_pb2_grpc.InferenceServiceServicer):
    def __init__(self, model_manager: ModelManager, config: ModelConfig):
        self.model_manager = model_manager
        self.config = config
        self.schedulers = {}
        self.resources: dict[str, ResourceManager] = {}  # Each GPU, each model on the CPU, and the API

        if any(m.cpu for _, m in self.model_manager):
            # For the whole process: on the CPU, requests run side by side, one thread each, as past a few threads a
            # single request barely speeds up
            torch.set_num_threads(1)

        for model_type, model in self.model_manager:
            resource = self._resource(model_type, model)
            for task_type, (prepare, func) in model.inference_methods.items():
                if model.gpu:
                    self.schedulers[task_type] = BatchScheduler(
                        resource_manager=resource,
                        prepare_func=prepare,
                        process_func=func,
                        batch_size=model.gpu.batch_size,
                        max_latency=model.gpu.max_latency,
                    )
                else:
                    self.schedulers[task_type] = SimpleScheduler(resource_manager=resource, process_func=func, prepare_func=prepare)

        self.monitor = Monitor(
            self.schedulers,
            [{'role': t.value, 'name': m.name, 'device': str(m.device or 'API'), 'dims': m.dims} for t, m in self.model_manager],
            gpus=sorted({m.device.index for _, m in self.model_manager if m.device and m.device.type == 'cuda'}),
        )

    def _resource(self, model_type: ModelType, model: BaseModel) -> ResourceManager:
        name = 'api' if model.remote else model_type.value if model.cpu else str(model.device)
        if name not in self.resources:
            if model.remote:
                self.resources[name] = ResourceManager(concurrency=self.config.vlm.openai.concurrency)
            elif model.cpu:
                on_cpu = sum(1 for _, m in self.model_manager if m.cpu)
                self.resources[name] = ResourceManager(concurrency=model.cpu.threads or max(1, psutil.cpu_count() // on_cpu))
            else:  # Models on one GPU take turns, a batch at a time
                self.resources[name] = ResourceManager(concurrency=1, post_execution_callback=torch.accelerator.empty_cache)
        return self.resources[name]

    async def start(self):
        for r in self.resources.values():
            await r.start()
        for s in self.schedulers.values():
            await s.start()
        await self.monitor.start()

    async def stop(self):
        await self.monitor.stop()
        for s in self.schedulers.values():
            await s.stop()
        for r in self.resources.values():
            await r.stop()

    async def _load_frames(self, image: inference_pb2.Image, context: grpc.aio.ServicerContext):
        loop = asyncio.get_running_loop()
        try:
            frames = await loop.run_in_executor(None, load_image_from_bytes, image.data, image.file_format)
        except Exception as e:
            logger.warning(f"Failed to decode {image.file_format or 'image'}: {e}")
            frames = []
        if not frames:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Unreadable image")
        return frames

    async def TextEmbedding(self, request: inference_pb2.TextEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.TextEmbeddingResponse:
        priority = request.options.priority
        embedding = await self.schedulers[ModelType.TEXT_EMBEDDING].submit(
            (request.text, request.task_description),
            priority=priority,
            context=context
        )
        return inference_pb2.TextEmbeddingResponse(
            embedding=inference_pb2.Embedding(values=embedding)
        )

    async def ClipImageEmbedding(self, request: inference_pb2.ClipImageEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.ClipImageEmbeddingResponse:
        frames = await self._load_frames(request.image, context)
        image = frames[len(frames) // 2]

        priority = request.options.priority
        embedding = await self.schedulers[ModelType.CLIP_IMAGE].submit(
            image,
            priority=priority,
            context=context
        )
        return inference_pb2.ClipImageEmbeddingResponse(
            embedding=inference_pb2.Embedding(values=embedding)
        )

    async def ClipTextEmbedding(self, request: inference_pb2.ClipTextEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.ClipTextEmbeddingResponse:
        priority = request.options.priority
        embedding = await self.schedulers[ModelType.CLIP_TEXT].submit(
            request.text,
            priority=priority,
            context=context
        )
        return inference_pb2.ClipTextEmbeddingResponse(
            embedding=inference_pb2.Embedding(values=embedding)
        )

    async def Rerank(self, request: inference_pb2.RerankRequest, context: grpc.ServicerContext) -> inference_pb2.RerankResponse:
        priority = request.options.priority
        score = await self.schedulers[ModelType.RERANKER].submit(
            ((request.query, request.document), request.task_description),
            priority=priority,
            context=context
        )
        return inference_pb2.RerankResponse(score=score)

    async def AnalyzeImage(self, request: inference_pb2.AnalyzeImageRequest, context: grpc.ServicerContext) -> inference_pb2.AnalyzeImageResponse:
        if request.caption_prompt and ModelType.VLM not in self.schedulers:
            await context.abort(grpc.StatusCode.UNIMPLEMENTED, "VLM model not configured")

        frames = await self._load_frames(request.image, context)
        priority = request.options.priority

        submits = [self.schedulers[ModelType.CLIP_IMAGE].submit(frames[len(frames) // 2], priority=priority, context=context)]
        if request.caption_prompt:
            submits.append(self.schedulers[ModelType.VLM].submit((draw_stitch(frames), request.caption_prompt), priority=priority, context=context))
        clip_embedding, *caption = await asyncio.gather(*submits)

        return inference_pb2.AnalyzeImageResponse(
            caption=caption[0] if caption else '',
            width=frames[0].width,
            height=frames[0].height,
            clip_embedding=inference_pb2.Embedding(values=clip_embedding)
        )

    async def Metrics(self, request: inference_pb2.MetricsRequest, context: grpc.ServicerContext) -> inference_pb2.MetricsResponse:
        snapshot = self.monitor.snapshot(request.span_seconds, request.step_seconds)
        return inference_pb2.MetricsResponse(json=json.dumps(snapshot).encode())
