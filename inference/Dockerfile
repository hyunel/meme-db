ARG BASE_IMAGE=ghcr.io/astral-sh/uv:python3.12-trixie-slim
FROM ${BASE_IMAGE}

WORKDIR /app
ENV TORCH=cuda INFERENCE_CACHE_DIR=/cache \
    UV_COMPILE_BYTECODE=1 UV_CACHE_DIR=/cache/uv \
    HF_HOME=/cache/huggingface TORCHINDUCTOR_CACHE_DIR=/cache/torchinductor
COPY . .

EXPOSE 50051
ENTRYPOINT ["sh", "start.sh"]
CMD ["-c", "models.yaml"]
