# MemeDB Server

The Go API behind MemeDB: accounts and sign-ins, libraries and sharing, file storage and search. A Postgres-backed task queue ingests memes in the background, captioning and embedding them through the [inference service](../inference/).

## Run

You need Go 1.24+, PostgreSQL with pgvector, and a running inference service. A database built from `sql/init.sql`:

```sh
docker run -d --name memedb-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres \
  -v "$PWD/sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" pgvector/pgvector:pg18-trixie
```

Then:

```sh
cp config.example.yaml config.yaml
go run ./cmd/api   # Reads config.yaml; serves on :8080
```

`init.sql` only builds a fresh database; one that already holds data is migrated by hand.

## Configuration

`config.yaml` is laid over the built-in defaults, so it only needs the keys you change; `config.example.yaml` lists them all with comments. `${VAR}` placeholders are read from the environment.

| Section | Sets |
| --- | --- |
| `storage` | Where uploads live: a local directory or an S3-compatible store |
| `database`, `inference` | The Postgres URL and the inference service's gRPC address |
| `worker`, `tasks` | Tasks run at once, and the maintenance tasks with their crons |
| `search`, `similar` | Hits per recall channel and how long a search's pages are kept |
| `tags` | Similarities that merge and suggest duplicate tags |
| `prompt` | The caption prompt and the language of titles, summaries and tags |
| `upload` | Size limit and accepted file types |

When the inference service's CLIP or text embedding model changes, the server rebuilds the stored embeddings by itself.

## API

The web signs in with an HttpOnly session cookie, scripts with a personal API token sent as `Authorization: Bearer mdb_…`. The site's `/developers` page documents the routes.

## Layout

```
cmd/api/              Entry point
internal/handler/     HTTP handlers (Echo)
internal/service/     Business logic
internal/repository/  Data access (pgx, pgvector)
internal/worker/      Task queue
internal/pkg/         Errors, access control, storage, inference client
internal/pb/          Generated gRPC code (make gen-proto)
sql/init.sql          Schema
tests/                Tests (go test ./tests/...)
```
