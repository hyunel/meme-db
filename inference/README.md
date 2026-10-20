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
TORCH=cuda sh start.sh   # cpu, cuda or xpu; serves on :50051
```

`start.sh` keeps a virtual environment for each backend under `cache/`, installs the dependencies, and passes its arguments on (`--port`, `-c models.yaml`). Model weights come from Hugging Face on first use. `UV_DEFAULT_INDEX`, `TORCH_INDEX_URL` and `HF_ENDPOINT` point the downloads at mirrors; `../.env.example` lists them all.

## Models

`models.yaml` gives each role its model and `device` (`auto`, `cpu`, `cuda:1`, `xpu`, `mps`, …), with `gpu` (batch size, dtype) and `cpu` (threads) settings. Its comments suggest smaller models for the CPU. `${VAR}` placeholders are read from the environment.

Models on one GPU take turns, each running requests in batches; models on the CPU and the VLM API run requests side by side, the API up to `vlm.openai.concurrency` at once.

The VLM captions every meme uploaded or reprocessed, so with a paid API each one costs money.
