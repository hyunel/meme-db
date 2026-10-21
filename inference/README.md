# MemeDB Inference

The Python gRPC service ([inference.proto](../protos/inference.proto)) that runs MemeDB's models for the [server](../server/):

| Role | Default model | Used for |
| --- | --- | --- |
| `clip` | `google/siglip2-base-patch16-224` | Image embeddings; image and text-to-image search |
| `embedding` | `Qwen/Qwen3-Embedding-0.6B` | Embeddings of captions, queries and tags |
| `reranker` | `Qwen/Qwen3-Reranker-0.6B` | Reranking search hits |
| `vlm` | An OpenAI-compatible API, or a local model such as Qwen3-VL | Captioning memes |

## Run

You need Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```sh
export VLM_MODEL=... VLM_API_KEY=... VLM_BASE_URL=...
uv run --extra cuda python -m app.main   # cpu, cuda or xpu; serves on :50051
```

The extra picks the PyTorch build; an Intel GPU also needs Intel's compute runtime on the host. `--port` and `-c models.yaml` set the port and the config. Model weights come from Hugging Face on first use, through `HF_ENDPOINT` if set. The [Dockerfile](Dockerfile) installs the same for its `TORCH` build argument, with the mirrors in `../.env.example`.

## Models

`models.yaml` gives each role its model and `device` (`auto`, `cpu`, `cuda:1`, `xpu`, `mps`, …), with `gpu` (batch size, dtype) and `cpu` (threads) settings. Under each default, a commented-out line offers a smaller model for the CPU. `${VAR}` placeholders are read from the environment.

Models on one GPU take turns, each running requests in batches; models on the CPU and the VLM API run requests side by side, the API up to `vlm.openai.concurrency` at once.

The VLM captions every meme uploaded or reprocessed, so with a paid API each one costs money.
