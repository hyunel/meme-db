import grpc
import logging
from .manager import ModelManager
from .models.base import ModelType
from .pb import inference_pb2, inference_pb2_grpc
from .utils import load_image_from_bytes, draw_stitch


logger = logging.getLogger(__name__)

class InferenceService(inference_pb2_grpc.InferenceServiceServicer):
    def __init__(self, model_manager: ModelManager):
        self.model_manager = model_manager

    def TextEmbedding(self, request: inference_pb2.TextEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.TextEmbeddingResponse:
        model = self.model_manager.text_embedding
        embeddings = model.get_embedding(list(request.texts), request.task_description)
        return inference_pb2.TextEmbeddingResponse(
            embeddings=[inference_pb2.Embedding(values=e) for e in embeddings]
        )

    def ClipImageEmbedding(self, request: inference_pb2.ClipImageEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.ClipImageEmbeddingResponse:
        images = []
        for img_msg in request.images:
            frames = load_image_from_bytes(img_msg.data, img_msg.file_format)
            assert frames, "No frames extracted from image data"

            images.append(frames[len(frames) // 2])

        model = self.model_manager.clip
        embeddings = model.get_image_embedding(images)
        return inference_pb2.ClipImageEmbeddingResponse(
            embeddings=[inference_pb2.Embedding(values=e) for e in embeddings]
        )

    def ClipTextEmbedding(self, request: inference_pb2.ClipTextEmbeddingRequest, context: grpc.ServicerContext) -> inference_pb2.ClipTextEmbeddingResponse:
        model = self.model_manager.clip
        embeddings = model.get_text_embedding(list(request.texts))
        return inference_pb2.ClipTextEmbeddingResponse(
            embeddings=[inference_pb2.Embedding(values=e) for e in embeddings]
        )

    def Rerank(self, request: inference_pb2.RerankRequest, context: grpc.ServicerContext) -> inference_pb2.RerankResponse:
        pairs = [(p.query, p.document) for p in request.pairs]
        model = self.model_manager.reranker
        scores = model.predict(pairs, request.task_description)
        return inference_pb2.RerankResponse(scores=scores)

    def ImageCaption(self, request: inference_pb2.ImageCaptionRequest, context: grpc.ServicerContext) -> inference_pb2.ImageCaptionResponse:
        """
        Generate captions for images using VLM and extract CLIP embeddings.
        """
        if ModelType.VLM not in self.model_manager.models:
            context.abort(grpc.StatusCode.UNIMPLEMENTED, "VLM model not configured")

        vlm_model = self.model_manager.vlm
        clip_model = self.model_manager.clip

        # Prepare all images for batch processing
        clip_images = []
        vlm_images = []
        image_dims = []

        for img_msg in request.images:
            # Load frames from various formats
            frames = load_image_from_bytes(img_msg.data, img_msg.file_format)
            assert frames, "No frames extracted from image data"

            image_dims.append((frames[0].width, frames[0].height))

            # For CLIP: use middle frame
            clip_images.append(frames[len(frames) // 2])

            # For VLM: use stitched image
            vlm_images.append(draw_stitch(frames))

        # Batch process CLIP embeddings
        clip_embeddings = clip_model.get_image_embedding(clip_images)

        # Process VLM caption generation
        captions = vlm_model.generate_caption(request.prompt, vlm_images)

        # Create results
        results = []
        for i, caption in enumerate(captions):
            width, height = image_dims[i]
            result = inference_pb2.ImageCaptionResult(
                caption=caption,
                width=width,
                height=height,
                clip_embedding=inference_pb2.Embedding(values=clip_embeddings[i])
            )
            results.append(result)

        return inference_pb2.ImageCaptionResponse(results=results)
