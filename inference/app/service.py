import grpc
import logging
import asyncio
from .manager import ModelManager
from .config import ModelType
from .pb import inference_pb2, inference_pb2_grpc
from .utils import load_image_from_bytes, draw_stitch
from .schedulers import BatchScheduler, SimpleScheduler, ResourceManager

logger = logging.getLogger(__name__)


class InferenceService(inference_pb2_grpc.InferenceServiceServicer):
    def __init__(self, model_manager: ModelManager):
        self.model_manager = model_manager
        self.schedulers = {}
        # Dual resource managers
        self.gpu_res = ResourceManager(concurrency=1)
        self.cpu_res = ResourceManager(concurrency=self.model_manager.config.concurrency)
        self._init_schedulers()

    def _init_schedulers(self):
        configs = self.model_manager.config.get_model_configs()

        # Define scheduler mapping
        scheduler_map = {
            ModelType.TEXT_EMBEDDING: [
                ("text_embedding", self.model_manager[ModelType.TEXT_EMBEDDING].get_embedding)
            ],
            ModelType.RERANKER: [
                ("reranker", self.model_manager[ModelType.RERANKER].predict)
            ],
            ModelType.CLIP: [
                ("clip_image", self.model_manager[ModelType.CLIP].get_image_embedding),
                ("clip_text", self.model_manager[ModelType.CLIP].get_text_embedding),
            ],
            ModelType.VLM: [
                ("vlm", self.model_manager[ModelType.VLM].generate_caption)
            ],
        }

        for model_type, entries in scheduler_map.items():
            if model_type not in self.model_manager.models:
                continue

            model = self.model_manager[model_type]
            cfg = configs[model_type]

            for name, func in entries:
                if model.is_gpu:
                    self.schedulers[name] = BatchScheduler(
                        resource_manager=self.gpu_res,
                        process_func=func,
                        batch_size=cfg.batch_size,
                        max_latency=cfg.max_latency,
                    )
                else:
                    self.schedulers[name] = SimpleScheduler(
                        resource_manager=self.cpu_res,
                        process_func=func,
                        concurrency=cfg.concurrency,
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
        embedding = await self.schedulers['text_embedding'].submit(
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
        embedding = await self.schedulers['clip_image'].submit(
            image,
            priority=priority,
            context=context
        )
        return inference_pb2.ClipImageEmbeddingResponse(
            embedding=inference_pb2.Embedding(values=embedding)
        )

    async def ClipTextEmbedding(self, request: inference_pb2.ClipTextEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.ClipTextEmbeddingResponse:
        priority = request.options.priority
        embedding = await self.schedulers['clip_text'].submit(
            request.text,
            priority=priority,
            context=context
        )
        return inference_pb2.ClipTextEmbeddingResponse(
            embedding=inference_pb2.Embedding(values=embedding)
        )

    async def Rerank(self, request: inference_pb2.RerankRequest, context: grpc.ServicerContext) -> inference_pb2.RerankResponse:
        priority = request.options.priority
        score = await self.schedulers['reranker'].submit(
            ((request.query, request.document), request.task_description),
            priority=priority,
            context=context
        )
        return inference_pb2.RerankResponse(score=score)

    async def ImageCaption(self, request: inference_pb2.ImageCaptionRequest, context: grpc.ServicerContext) -> inference_pb2.ImageCaptionResponse:
        if 'vlm' not in self.schedulers:
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
        clip_future = self.schedulers['clip_image'].submit(
            clip_image,
            priority=priority,
            context=context
        )
        vlm_future = self.schedulers['vlm'].submit(
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
