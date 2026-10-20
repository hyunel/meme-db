# MemeDB

A semantic search engine for memes. A vision language model reads each meme: its text, who is in it, the joke and when people send it. Searches recall memes through four channels (metaphor, semantic, CLIP and OCR) and rerank what they find.

- Search by words or by image, and find similar memes
- Upload images, GIFs, videos and Lottie stickers (`.tgs`, `.lottie`); captioning runs in the background
- Folders, public sharing, favorites and tags
- An admin console for content, tags, users, tasks, logs and the models
- Personal API tokens for scripts
- Chinese and English, following the browser or a switch in the footer

## Projects

| Project | Stack | Role |
| --- | --- | --- |
| [server](server/) | Go, Echo, PostgreSQL + pgvector | The API: accounts, libraries, storage, search, and the task queue that ingests memes |
| [inference](inference/) | Python, PyTorch, gRPC | VLM captions, CLIP and text embeddings, reranking |
| [web](web/) | Next.js, React | The site and the admin console |
| [protos](protos/) | Protobuf | The gRPC contract between server and inference |

```
browser ──▶ web :3000 ──/api──▶ server :8080 ──gRPC──▶ inference :50051
                                    │
                           PostgreSQL + pgvector
```

## Quick start

Docker Compose runs all of it from a checkout of the latest release, the inference service on an NVIDIA GPU by default:

```sh
git clone https://github.com/hyunel/meme-db.git && cd meme-db
git checkout $(git describe --tags --abbrev=0)
cp .env.example .env   # Fill in your OpenAI-compatible VLM provider
docker compose up -d
```

Compose pulls the release images `ghcr.io/hyunel/meme-db/{server,web,inference}:latest` (`docker compose pull` updates them); `docker compose up -d --build` builds them from the checkout instead. Open http://localhost:3000. The first start downloads Python dependencies and model weights, which can take a while; the server waits for it. For a CPU or an Intel GPU, follow the comments in `.env.example`.

Settings come from files in the checkout, which Compose mounts:

- `inference/models.yaml` picks the models: by default captions come from the VLM API in `.env` and the other models run on the GPU. Its comments show a local VLM and smaller models for the CPU. After a change, `docker compose restart inference`; the server re-embeds every meme when the CLIP or text embedding model changes.
- `server/config.docker.yaml` overrides the [server's settings](server/README.md#configuration), such as the language of captions or S3 storage. After a change, `docker compose restart server`.

Accounts start as users. To make yours an admin after signing up:

```sh
docker compose exec db psql -U postgres -d memedb -c "UPDATE iam.users SET role = 'admin' WHERE username = 'you'"
```

The VLM captions every meme uploaded or reprocessed, so with a paid API each one costs money.

## Development

Each project's README explains how to run it on its own; `make dev-server`, `make dev-ai` and `make dev-web` start them. After editing `protos/`, run `make gen-proto` to regenerate the Go and Python code.

Pushing a tag `vX.Y.Z` publishes the images, tagged `X.Y.Z`, `X.Y` and `latest`, with a GitHub release of the changes since the previous tag.
