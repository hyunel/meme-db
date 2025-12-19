import io
import logging
import av
import cairosvg
from io import BytesIO
from lottie.parsers.tgs import parse_tgs
from lottie.exporters import export_svg
from typing import List, BinaryIO
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)


def draw_stitch(frames: List[Image.Image]) -> Image.Image:
    """
    Stitch multiple frames vertically with frame labels.
    """
    if len(frames) == 1:
        return frames[0]

    for idx, img in enumerate(frames):
        draw = ImageDraw.Draw(img)
        text = f"Key Frame {idx+1}/{len(frames)}"

        # Draw text with outline for better visibility
        x, y = 10, 10
        draw.text((x-1, y), text, fill="black")
        draw.text((x+1, y), text, fill="black")
        draw.text((x, y-1), text, fill="black")
        draw.text((x, y+1), text, fill="black")
        draw.text((x, y), text, fill="white")

    # Vertical Stitch
    max_width = max(img.width for img in frames)
    total_height = sum(img.height for img in frames)
    stitched = Image.new('RGB', (max_width, total_height))

    y_offset = 0
    for img in frames:
        stitched.paste(img, (0, y_offset))
        y_offset += img.height
    return stitched


def generate_frame_indices(total_frames: int, percentiles: List[float] = [0.1, 0.5, 0.9]) -> List[int]:
    """
    Generate frame indices at specified percentiles.
    """
    indices = []
    for p in percentiles:
        index = int(total_frames * p)
        index = max(0, min(index, total_frames - 1))  # Clamp to valid range
        if index not in indices:
            indices.append(index)
    return indices


def generate_webm_frames(f: BinaryIO) -> List[Image.Image]:
    """
    Extract key frames from webm video file.
    """
    frames = []
    with av.open(f) as container:
        for frame in container.decode(video=0):
            frames.append(frame.to_image())

    if not frames:
        raise ValueError(f"No frames extracted")

    # Extract key frames
    indices = generate_frame_indices(len(frames))
    return [frames[idx].copy() for idx in indices]


def generate_tgs_frames(f: BinaryIO) -> List[Image.Image]:
    """
    Extract key frames from Telegram animated sticker (.tgs) file.
    """
    animation = parse_tgs(f)

    total_frames = int(animation.out_point - animation.in_point)
    if total_frames < 1:
        raise ValueError(f"Invalid animation")

    indices = generate_frame_indices(total_frames)
    key_frames = []

    for idx in indices:
        # Export frame as SVG
        svg_buffer = io.BytesIO()
        export_svg(animation, svg_buffer, frame=idx, pretty=False)
        svg_buffer.seek(0)

        # Convert SVG to PNG
        png_buffer = io.BytesIO()
        cairosvg.svg2png(file_obj=svg_buffer, write_to=png_buffer)
        png_buffer.seek(0)

        key_frames.append(Image.open(png_buffer).copy())

    return key_frames

def load_image_from_bytes(bytes_data: bytes, file_format: str) -> List[Image.Image]:
    """
    Load frames from any supported image/video format.
    """
    file_format = file_format.lstrip('.').lower()
    with BytesIO(bytes_data) as f:
        if file_format == 'tgs':
            return generate_tgs_frames(f)
        elif file_format == 'webm':
            return generate_webm_frames(f)
        else:
            return [Image.open(f).copy()]
