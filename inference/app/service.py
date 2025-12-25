import grpc
import torch
import logging
import asyncio
from .manager import ModelManager
from .config import ModelType, ModelConfig
from .pb import inference_pb2, inference_pb2_grpc
from .utils import load_image_from_bytes, draw_stitch
from .schedulers import BatchScheduler, SimpleScheduler, ResourceManager

logger = logging.getLogger(__name__)


class InferenceService(inference_pb2_grpc.InferenceServiceServicer):
    def __init__(self, model_manager: ModelManager, config: ModelConfig):
        self.model_manager = model_manager
        self.config = config
        self.schedulers = {}

        # Dual resource managers
        self.gpu_res = ResourceManager(concurrency=1, post_execution_callback=self._clear_cuda_cache)
        self.cpu_res = ResourceManager(concurrency=self.config.concurrency)
        self._init_schedulers()

    def _clear_cuda_cache(self):
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _init_schedulers(self):
        configs = self.config.get_model_configs()
        for model_type, model in self.model_manager:
            config = configs[model_type]
            for task_type, func in model.inference_methods.items():
                if model.is_gpu:
                    self.schedulers[task_type] = BatchScheduler(
                        resource_manager=self.gpu_res,
                        process_func=func,
                        batch_size=config.batch_size,
                        max_latency=config.max_latency,
                    )
                else:
                    self.schedulers[task_type] = SimpleScheduler(
                        resource_manager=self.cpu_res,
                        process_func=func,
                        concurrency=config.concurrency,
                    )

    async def start(self):
        await self.gpu_res.start()
        await self.cpu_res.start()
        for s in self.schedulers.values():
            await s.start()

    async def stop(self):
        for s in self.schedulers.values():
            await s.stop()
        await self.gpu_res.stop()
        await self.cpu_res.stop()

    # --- RPC Methods ---

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
        loop = asyncio.get_running_loop()
        frames = await loop.run_in_executor(None, load_image_from_bytes, request.image.data, request.image.file_format)
        if not frames:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "No frames extracted from image")

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

    async def ImageCaption(self, request: inference_pb2.ImageCaptionRequest, context: grpc.ServicerContext) -> inference_pb2.ImageCaptionResponse:
        if ModelType.VLM not in self.schedulers:
            context.abort(grpc.StatusCode.UNIMPLEMENTED, "VLM model not configured")

        loop = asyncio.get_running_loop()
        frames = await loop.run_in_executor(None, load_image_from_bytes, request.image.data, request.image.file_format)
        if not frames:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "No frames extracted from image")

        # Prepare inputs
        clip_image = frames[len(frames) // 2]
        vlm_image = draw_stitch(frames)
        width, height = frames[0].width, frames[0].height

        priority = request.options.priority

        # Submit to both schedulers
        clip_future = self.schedulers[ModelType.CLIP_IMAGE].submit(
            clip_image,
            priority=priority,
            context=context
        )
        vlm_future = self.schedulers[ModelType.VLM].submit(
            (vlm_image, request.prompt),
            priority=priority,
            context=context
        )

        # Wait for results
        clip_embedding, caption = await asyncio.gather(clip_future, vlm_future)

        return inference_pb2.ImageCaptionResponse(
            caption=caption,
            width=width,
            height=height,
            clip_embedding=inference_pb2.Embedding(values=clip_embedding)
        )
