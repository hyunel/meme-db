import av
import gzip
import threading
from io import BytesIO
from rlottie_python import LottieAnimation
from typing import List, BinaryIO
from PIL import Image, ImageDraw

# rlottie_python retypes the shared C functions for each call's buffer sizes, so concurrent calls can clash.
_rlottie_lock = threading.Lock()


def draw_stitch(frames: List[Image.Image]) -> Image.Image:
    if len(frames) == 1:
        return frames[0]

    for idx, img in enumerate(frames):
        draw = ImageDraw.Draw(img)
        text = f"Key Frame {idx+1}/{len(frames)}"
        x, y = 10, 10
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):  # Outline, so the label reads on any background
            draw.text((x + dx, y + dy), text, fill="black")
        draw.text((x, y), text, fill="white")

    stitched = Image.new('RGB', (max(img.width for img in frames), sum(img.height for img in frames)))
    y_offset = 0
    for img in frames:
        stitched.paste(img, (0, y_offset))
        y_offset += img.height

    return stitched


def generate_frame_indices(total_frames: int, percentiles: List[float] = [0.1, 0.5, 0.9]) -> List[int]:
    indices = []
    for p in percentiles:
        index = max(0, min(int(total_frames * p), total_frames - 1))  # Clamp to valid range
        if index not in indices:
            indices.append(index)

    return indices


def generate_webm_frames(f: BinaryIO) -> List[Image.Image]:
    with av.open(f) as container:
        frames = [frame.to_image() for frame in container.decode(video=0)]

    if not frames:
        raise ValueError("No frames extracted")

    return [frames[idx].copy() for idx in generate_frame_indices(len(frames))]


def generate_tgs_frames(f: BinaryIO) -> List[Image.Image]:
    data = f.read()
    if data[:2] == b'\x1f\x8b':  # .tgs is gzipped Lottie JSON
        data = gzip.decompress(data)
    with _rlottie_lock, LottieAnimation.from_data(data.decode()) as animation:
        total_frames = animation.lottie_animation_get_totalframe()
        if total_frames < 1:
            raise ValueError("Invalid animation")
        size = animation.lottie_animation_get_size()
        # rlottie renders premultiplied alpha, which BGRa undoes.
        return [Image.frombuffer('RGBA', size, animation.lottie_animation_render(frame_num=idx), 'raw', 'BGRa', 0, 1)
                for idx in generate_frame_indices(total_frames)]


def rgba_to_rgb(image: Image.Image, background_color=(255, 255, 255)) -> Image.Image:
    if image.mode == 'RGBA':
        background = Image.new('RGB', image.size, background_color)
        background.paste(image, mask=image.split()[3])  # 3 is the alpha channel
        return background
    return image.convert('RGB')


def load_image_from_bytes(bytes_data: bytes, file_format: str) -> List[Image.Image]:
    file_format = file_format.lstrip('.').lower()
    with BytesIO(bytes_data) as f:
        if file_format in ['tgs', 'lottie', 'json']:
            frames = generate_tgs_frames(f)
        elif file_format in ['webm', 'mp4']:
            frames = generate_webm_frames(f)
        else:
            frames = [Image.open(f).copy()]

    return [rgba_to_rgb(img) for img in frames]
