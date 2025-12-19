from typing import List, Dict, Any, TYPE_CHECKING
from abc import abstractmethod
from PIL import Image
import logging
import json
import re
from ..base import BaseModel

if TYPE_CHECKING:
    from ...config import ModelConfig

VLM_PROMPT = """
# Role
You are an expert in Internet culture, semiotics, and visual analysis. Your task is to extract structured, high-density feature representations from the provided Meme image for a search engine.

# Constraints
1. NO Yapping: Do not use filler sentences like "The image depicts..." or "It seems to be...". Output raw, descriptive keywords and concise phrases.
2. Deep Reasoning: Analyze the interplay between the visual elements and the text to decode the *implied* meaning (sarcasm, irony, metaphor).
3. Format: Output STRICT JSON format only.

# Extraction Tasks (Think Step-by-Step)
Analyze the image in the following dimensions:

1.  OCR_Text: Transcribe all visible text verbatim.
2.  Visual_Subject: Describe the main visible elements using concise keywords or short phrases.
    - Examples: "Sweating Man", "Confused Cat", "Dinner Table", "Golden Hair", "Blue Eyes".
3.  Specific_Entities: Identify specific proper names, including celebrities, fictional characters, anime figures, famous IP sources, and source works.
    - Examples: "Hatsune Miku", "Elon Musk", "SpongeBob".
    - Constraint: **High Confidence Only**. If the character is generic, ambiguous, or you are not 100% sure of the identity, leave this array empty to avoid hallucinations.
4.  Visual_Style: Describe the aesthetic style using concise professional tags.
    - Examples: "3D Render", "Pixel Art", "Wojak", "Realistic", "Screenshot", "Anime", "Chibi".
    - Constraint: **DO NOT** describe image quality.
5.  Implied_Meaning: What specific vibe, attitude, or social reaction does sending this image convey?
    - Examples: "Smug superiority", "Pretending everything is fine", "Chaotic panic", "Reluctant acceptance", "Sarcastic surprise", "Sexual innuendo".
6.  Synthetic_Queries: Generate 3-5 distinct search queries a user would likely type.
    - Examples: "my face when boss calls", "shut up and take money", "awkward silence reaction", "math lady confused".
    - Constraint: Generate the **raw usage scenario**, **conversational intent**, or **internal monologue** directly, without meta descriptors (e.g., "XXX meme", "image for XXX").

# Output Schema (JSON)
{
  "ocr_text": "String" or null,
  "visual_subject": ["Keyword1", "Keyword2", ...],
  "specific_entities": ["Entity1", "Entity2", ...] or [],
  "visual_style": ["Tag1", "Tag2", ...],
  "implied_meaning": ["Keyword1", "Keyword2", ...],
  "synthetic_queries": ["Query1", "Query2", ...]
}
"""


class VLMModel(BaseModel):
    """
    Abstract base class for Vision Language Models.
    """

    @abstractmethod
    def _load_model(self) -> None:
        """Load the VLM model."""
        pass

    @abstractmethod
    def analyze_images(self, images: List[Image.Image]) -> List[Dict[str, Any]]:
        """
        Analyze images using VLM and return structured JSON results.

        This method processes multiple images independently (not in a single conversation).
        Each image gets its own separate analysis.

        Args:
            images: List of PIL Images to analyze independently

        Returns:
            List of dictionaries with VLM analysis results, one per image
        """
        pass

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except:
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                raise ValueError("No JSON object found in the response text.")
