import numpy as np
from PIL import Image
from app.manager import ModelManager

print("Loading models...")
manager = ModelManager()
models = manager.load_models()

print("Testing Text Embedding...")
text_model = models.text_embedding
text_embed1, text_embed2, text_embed3 = text_model.get_embedding(["Hello?", "How are you?", "Goodbye."])
text_embed_score1 = np.array(text_embed1) @ np.array(text_embed2).T
text_embed_score2 = np.array(text_embed1) @ np.array(text_embed3).T
print(f'Text embedding scores: {text_embed_score1}, {text_embed_score2}')
assert text_embed_score1 > text_embed_score2

print("Testing Reranker...")
reranker_model = models.reranker
pairs = [("What is AI?", "AI is the simulation of human intelligence."), ("What is AI?", "The sky is blue.")]
rerank_score1, rerank_score2 = reranker_model.predict(pairs)
print(f'Rerank scores: {rerank_score1}, {rerank_score2}')
assert rerank_score1 > rerank_score2

print("Testing CLIP...")
clip_model = models.clip
clip_text_embed1, clip_text_embed2 = clip_model.get_text_embedding(["A red square.", "A blue circle."])
clip_image_embed = clip_model.get_image_embedding([Image.new('RGB', (224, 224), color = 'red')])[0]
clip_score1 = np.array(clip_image_embed) @ np.array(clip_text_embed1).T
clip_score2 = np.array(clip_image_embed) @ np.array(clip_text_embed2).T
print(f'CLIP scores: {clip_score1}, {clip_score2}')
assert clip_score1 > clip_score2

print("All tests passed!")