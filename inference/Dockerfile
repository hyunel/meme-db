FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
# cpu installs torch without the CUDA libraries, for machines with no GPU
ARG TORCH=cuda
# No persistent uv cache: packages are hardlinked from a temporary one, so the
# dependencies are stored once in the image.
ENV UV_COMPILE_BYTECODE=1 UV_NO_CACHE=1 \
    HF_HOME=/cache/huggingface TORCHINDUCTOR_CACHE_DIR=/cache/torchinductor
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --extra $TORCH
COPY . .

EXPOSE 50051
CMD ["uv", "run", "--no-sync", "python", "-m", "app.main", "-c", "models.yaml"]
