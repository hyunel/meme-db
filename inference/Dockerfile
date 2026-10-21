ARG BASE_IMAGE=ghcr.io/astral-sh/uv:python3.12-trixie-slim
FROM ${BASE_IMAGE}

WORKDIR /app
# cpu, cuda or xpu
ARG TORCH=cpu

# An Intel GPU's runtime, from Debian and Intel's releases on GitHub
ARG APT_MIRROR=http://deb.debian.org/debian APT_SECURITY_MIRROR=http://deb.debian.org/debian-security \
    GITHUB_RELEASE_BASE_URL=https://github.com IGC=2.41.5+22716 NEO=26.35.39758.10 GMM=22.10.0 LEVEL_ZERO=1.34.0
# Debian's Level Zero loader is too old for PyTorch's runtime, and oneDNN also compiles kernels through OpenCL
RUN if [ "$TORCH" = xpu ]; then \
        sed -i -e "s|^URIs: http://deb.debian.org/debian$|URIs: $APT_MIRROR|" \
            -e "s|^URIs: http://deb.debian.org/debian-security$|URIs: $APT_SECURITY_MIRROR|" /etc/apt/sources.list.d/debian.sources \
        && apt-get update && apt-get install -y --no-install-recommends curl \
        && releases=$GITHUB_RELEASE_BASE_URL/intel && cd /tmp \
        && curl -fL --retry 3 \
            -O "$GITHUB_RELEASE_BASE_URL/oneapi-src/level-zero/releases/download/v$LEVEL_ZERO/libze1_${LEVEL_ZERO}+u24.04_amd64.deb" \
            -O "$releases/intel-graphics-compiler/releases/download/v${IGC%+*}/intel-igc-core-2_${IGC}_amd64.deb" \
            -O "$releases/intel-graphics-compiler/releases/download/v${IGC%+*}/intel-igc-opencl-2_${IGC}_amd64.deb" \
            -O "$releases/compute-runtime/releases/download/$NEO/libigdgmm12_${GMM}_amd64.deb" \
            -O "$releases/compute-runtime/releases/download/$NEO/libze-intel-gpu1_$NEO-0_amd64.deb" \
            -O "$releases/compute-runtime/releases/download/$NEO/intel-opencl-icd_$NEO-0_amd64.deb" \
        && apt-get install -y --no-install-recommends ./*.deb \
        && rm -rf ./*.deb /var/lib/apt/lists/*; \
    fi

# Mirrors for Python packages, and PyTorch's index for the CPU or an Intel GPU
ARG UV_DEFAULT_INDEX TORCH_INDEX_URL
# uv's cache stays with the builder, out of the image, so a rebuild downloads only the packages that changed
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH \
    HF_HOME=/cache/huggingface TORCHINDUCTOR_CACHE_DIR=/cache/torchinductor
COPY pyproject.toml ./
# The index stays explicit: passing it with --index would route every package there
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -n "${TORCH_INDEX_URL:-}" ]; then \
        sed -i "/^name = \"pytorch-$TORCH\"$/,/^explicit = true$/s|^url = .*|url = \"$TORCH_INDEX_URL\"|" pyproject.toml; \
    fi \
    && uv venv "$VIRTUAL_ENV" && uv pip install -r pyproject.toml --extra "$TORCH"
COPY . .

EXPOSE 50051
ENTRYPOINT ["python", "-m", "app.main"]
