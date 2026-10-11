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

        self.gpu_res = ResourceManager(concurrency=1, post_execution_callback=torch.cuda.empty_cache if torch.cuda.is_available() else None)
        self.cpu_res = ResourceManager(concurrency=self.config.concurrency)

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

    async def ImageCaption(self, request: inference_pb2.ImageCaptionRequest, context: grpc.ServicerContext) -> inference_pb2.ImageCaptionResponse:
        if ModelType.VLM not in self.schedulers:
            await context.abort(grpc.StatusCode.UNIMPLEMENTED, "VLM model not configured")

        frames = await self._load_frames(request.image, context)

        clip_image = frames[len(frames) // 2]
        vlm_image = draw_stitch(frames)
        width, height = frames[0].width, frames[0].height

        priority = request.options.priority

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

        clip_embedding, caption = await asyncio.gather(clip_future, vlm_future)

        return inference_pb2.ImageCaptionResponse(
            caption=caption,
            width=width,
            height=height,
            clip_embedding=inference_pb2.Embedding(values=clip_embedding)
        )
