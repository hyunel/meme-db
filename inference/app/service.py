import json
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
            # Use utils to handle various formats
            frames = load_image_from_bytes(img_msg.data, img_msg.file_format)
            # For CLIP, use the middle frame
            middle_idx = len(frames) // 2
            images.append(frames[middle_idx])

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

    def AnalyzeImage(self, request: inference_pb2.AnalyzeImageRequest, context: grpc.ServicerContext) -> inference_pb2.AnalyzeImageResponse:
        """
        Analyze images using VLM and CLIP to extract features.
        Handles multiple image formats including webm, tgs, etc.
        Processes all images in parallel/batch for efficiency.
        """
        if ModelType.VLM not in self.model_manager.models:
            context.abort(grpc.StatusCode.UNIMPLEMENTED, "VLM model not configured")

        vlm_model = self.model_manager.vlm
        clip_model = self.model_manager.clip
        text_model = self.model_manager.text_embedding

        # Prepare all images for batch processing
        clip_images = []
        vlm_images = []
        vlm_results = []
        image_dims = []

        for i, item in enumerate(request.inputs):
            # Load frames from various formats
            frames = load_image_from_bytes(item.image.data, item.image.file_format)

            if frames:
                image_dims.append((frames[0].width, frames[0].height))
            else:
                image_dims.append((0, 0))

            # For CLIP: use middle frame
            middle_idx = len(frames) // 2
            clip_images.append(frames[middle_idx])

            if item.vlm_json:
                vlm_results.append(json.loads(item.vlm_json))
            else:
                vlm_images.append(draw_stitch(frames))
                vlm_results.append(None)

        # Batch process CLIP embeddings
        clip_embeddings = clip_model.get_image_embedding(clip_images)

        # Process VLM analysis (parallel for OpenAI, batch for local)
        if vlm_images:
            new_vlm_results = iter(vlm_model.analyze_images(vlm_images))
            vlm_results = [
                next(new_vlm_results) if r is None else r
                for r in vlm_results
            ]

        # Prepare text embedding requests
        metaphor_texts = []
        semantic_texts = []

        for vlm_result in vlm_results:
            metaphor_array = vlm_result.get('synthetic_queries', []) + vlm_result.get('implied_meaning', [])
            semantic_array = vlm_result.get('specific_entities', []) + vlm_result.get('visual_subject', []) + vlm_result.get('visual_style', [])

            metaphor_texts.append(', '.join(metaphor_array) if metaphor_array else '')
            semantic_texts.append(', '.join(semantic_array) if semantic_array else '')

        # Batch process text embeddings
        metaphor_embs = text_model.get_embedding(metaphor_texts)
        semantic_embs = text_model.get_embedding(semantic_texts)

        # Create results
        results = []
        for i, vlm_result in enumerate(vlm_results):
            width, height = image_dims[i]
            result = inference_pb2.AnalyzedImage(
                ocr_text=vlm_result.get("ocr_text", ""),
                clip_vector=clip_embeddings[i],
                metaphor_vector=metaphor_embs[i],
                semantic_vector=semantic_embs[i],
                vlm_json=json.dumps(vlm_result, ensure_ascii=False),
                width=width,
                height=height
            )
            results.append(result)

        return inference_pb2.AnalyzeImageResponse(results=results)
