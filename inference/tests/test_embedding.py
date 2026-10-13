import pytest
import numpy as np
from PIL import Image
from app.config import ModelConfig, ModelType
from app.manager import ModelManager

@pytest.fixture(scope="module")
def manager():
    print("Loading models...")
    return ModelManager(ModelConfig.from_yaml("models.yaml")).load_models()

def infer(model, task, items):
    prepare, run = model.inference_methods[task]
    return run(prepare(items))

def test_text_embedding(manager):
    print("Testing Text Embedding...")
    text_model = manager[ModelType.TEXT_EMBEDDING]
    texts = ["Hello?", "How are you?", "Goodbye."]

    text_embed1, text_embed2, text_embed3 = infer(text_model, ModelType.TEXT_EMBEDDING, [(t, "") for t in texts])

    text_embed_score1 = np.array(text_embed1) @ np.array(text_embed2).T
    text_embed_score2 = np.array(text_embed1) @ np.array(text_embed3).T

    print(f'Text embedding scores: {text_embed_score1}, {text_embed_score2}')
    assert text_embed_score1 > text_embed_score2

def test_reranker(manager):
    print("Testing Reranker...")
    reranker_model = manager[ModelType.RERANKER]
    pairs = [("What is AI?", "AI is the simulation of human intelligence."), ("What is AI?", "The sky is blue.")]

    rerank_score1, rerank_score2 = infer(reranker_model, ModelType.RERANKER, [(p, "") for p in pairs])

    print(f'Rerank scores: {rerank_score1}, {rerank_score2}')
    assert rerank_score1 > rerank_score2

def test_clip(manager):
    print("Testing CLIP...")
    clip_model = manager[ModelType.CLIP]
    clip_text_embed1, clip_text_embed2 = infer(clip_model, ModelType.CLIP_TEXT, ["A red square.", "A blue circle."])
    clip_image_embed = infer(clip_model, ModelType.CLIP_IMAGE, [Image.new('RGB', (224, 224), color = 'red')])[0]

    clip_score1 = np.array(clip_image_embed) @ np.array(clip_text_embed1).T
    clip_score2 = np.array(clip_image_embed) @ np.array(clip_text_embed2).T

    print(f'CLIP scores: {clip_score1}, {clip_score2}')
    assert clip_score1 > clip_score2
