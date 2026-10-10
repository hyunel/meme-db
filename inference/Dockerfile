FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# cairo renders SVG/Lottie frames for captioning
RUN apt-get update && apt-get install -y --no-install-recommends libcairo2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    HF_HOME=/cache/huggingface TORCHINDUCTOR_CACHE_DIR=/cache/torchinductor
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .

EXPOSE 50051
CMD ["uv", "run", "--no-sync", "python", "-m", "app.main", "-c", "models.yaml"]
