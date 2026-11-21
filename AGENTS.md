## Project Overview
MemeDB is a semantic search engine designed for meme images. It leverages Vision Language Models (VLM) to understand the visual and cultural context of memes, and uses vector embeddings for high-accuracy retrieval.

## Architecture

The system consists of three main components:

1.  **Server (Go)**:
    - **Framework**: Echo
    - **Database**: PostgreSQL + pgvector
    - **Role**: Handles API requests, authentication, file storage, and orchestrates the ingestion pipeline.
    - **Task Queue**: Postgres-backed queue for asynchronous processing (ingestion, indexing).

2.  **Inference Service (Python)**:
    - **Communication**: gRPC
    - **Role**: Provides VLM captioning, embedding generation (CLIP, Text) and Reranking services.

3.  **Web (Next.js)**:
    - **Stack**: Next.js 16 (App Router), React 19, SWR, Tailwind v4, shadcn components on Base UI.
    - **Role**: The site and the admin console; reaches the server through `/api`, which `app/api/[...path]` streams to it.

## Directory Structure

```
MemeDB/
├── protos/             # Protobuf definitions
├── server/             # Go Backend
│   ├── cmd/            # Entry points
│   ├── internal/       # Application logic
│   │   ├── config/     # Configuration
│   │   ├── db/         # Connection; schema migrations
│   │   ├── handler/    # HTTP Handlers
│   │   ├── service/    # Business Logic
│   │   ├── repository/ # Data Access
│   │   └── worker/     # Async Worker
│   └── tests/          # Integration & Unit Tests
├── inference/          # Python Inference Service
└── web/                # Next.js Frontend
```

## Development Standards

### General
- **Surgical Changes**: Do NOT make any changes outside the explicit scope of the task. ALWAYS clean up obsolete code (e.g., unused functions, structs) resulting from the refactoring required by the task.
- **Concise Code**: Inline one-line or single-use logic instead of wrapping it in a helper; extract functions only for real logic or genuine duplication.
- **Comments**: Add brief inline comments only where the code alone is unclear (a reason, a contract, a unit). No doc blocks that restate a name, step-by-step narration or section banners.

### Go Server
- **Architecture**: Follow Clean Architecture (Handlers -> Services -> Repositories).
  - **Handlers**:
    - Place handler-specific request/response models directly in the handler file, near the methods that use them.
    - Consolidate all input parameters (Path, Query, Body) into a single named request struct.
    - Avoid direct usage of `c.Param`, `c.QueryParam`, etc. Use `BindAndValidate` with the request struct instead.
  - **Services**: Services must be independent of handler-specific models. Use primitive types or service-specific DTOs if necessary.
- **Dependency Injection**: Use Interfaces for dependencies to facilitate testing.
- **Testing**:
  - Tests must be placed in `server/tests/`.
  - Use `testify` for assertions and mocks.
- **Database**:
  - Use `pgx/v5` driver.
  - Use `pgvector-go` for vector operations.
- **Configuration**: Use `config.yaml` and `internal/config` package.
- **CLI**: `cmd/api/main.go` runs one of its `commands`: `serve` the API, or maintenance such as backups and accounts.

### Database & Transaction Management
- **Repository Pattern**: Repositories must focus solely on data access and query execution.
- **DB Interface**: Repositories must accept a `db.DBTX` interface in their constructors. They must NOT manage transactions internally.
- **Transaction Management**:
  - Transactions must be managed at the Service layer using the `repository.Provider`.
  - For simple queries, use the default repositories provided by the `Provider` (e.g., `s.repo.User.Get`).
  - For multiple operations requiring atomicity, use the `Transaction` helper (`Provider.Tx`).
- **Access Control**: Enforced explicitly in repository queries (owner / visibility filters); there is no row-level security. A node is public if it or an ancestor folder is public (`library.public_files`).
- **Sign-ins**: The web signs in with a session cookie (`iam.sessions`, HttpOnly, revocable), scripts with a personal API token (`mdb_…`), whose scope `rbac` enforces: `read` tokens may only GET signed-in routes, the admin API needs the `admin` scope, and routes under `rbac.RequireSession()` (password, sign-ins, tokens) refuse tokens altogether.
- **Schema**: Numbered migrations in `server/internal/db/migrations/` build the database; `serve` applies new ones as it starts, each in a transaction. Change the schema with a new migration, never by editing one that has been applied.
- **Events & Popularity**: `POST /api/events` accepts external `use` (admin only, no deduplication) and general `view` events with optional share context; `save` is internal. External sources consume events durably before sending and never retry. Non-admin timestamps are ignored; omitted timestamps use the database default. A trigger on `core.events` adds each event to its meme's or folder's lifetime counts and to its link's share counters. `refresh_stats` recounts day/week/month from `core.events` over the windows, then refreshes `tag_usage`; only `use` affects popularity. Ranked lists use an ID cursor.
- **Logs**: `ops.logs` is a time-partitioned hypertable. `purge_logs` drops wholly expired chunks using its configured `retention`; boundary logs remain until their chunk expires.
- **Backups**: `backup export` copies every table of `core`, `iam` and `library` but their vector columns and the tables in `backupSkipped` (`BackupService`); a new table the server works out again belongs there.

### Protobuf Workflow
- **Definition**: Protocol buffers are defined in `protos/`.
- **Generation**: Run `make gen-proto` in the root directory to regenerate Go and Python code after modifying `.proto` files.
  - This updates `server/internal/pb/` (Go) and `inference/app/pb/` (Python).

### Error Handling
- **Service Layer**: Services should return `apperror` types (from `server/internal/pkg/apperror`) for expected errors (e.g., `apperror.NotFound`, `apperror.BadRequest`). Unexpected internal errors should be returned as raw `error`, which will default to an Internal Server Error (500) in the handler.
- **Handler Layer**: Handlers should simply return the error from the service layer. Avoid manual `c.JSON` or `c.String` for error responses.
- **Language**: Backend text is English: an `apperror` carries a stable snake_case code and an English message, with params for the values it mentions (`apperror.BadRequest("file_too_large", "...").With("max_mb", n)`); logs and task errors are English too. The web words errors by code in the `errors` of its dictionaries (`web/lib/i18n/zh.ts`, `en.ts`), so add each new code there.

### Web
- Read `web/AGENTS.md` first: this Next.js version differs from what you may know.
- Build UI from `components/ui` and the theme tokens in `app/globals.css`; fetch with SWR through `lib/api`, calling `refresh()` after mutations.
- UI text comes from the dictionaries in `lib/i18n` (`zh.ts`, with `en.ts` typed after it), through `useMessages()` in client components and `getMessages()` on the server. The server renders each page in the visitor's language (the `memedb_locale` cookie, else `Accept-Language`), so never pick it in the browser.
- The public pages (meme, folder, profile, tag) fetch their record on the server through `lib/server-api`, as the visitor by their cookie, for their metadata and first paint, and hand it to SWR as `fallbackData`.
- Keep `lib/types.ts` in sync with the server's JSON, and the API reference in `components/api-docs.tsx` with the routes.

### Inference Service
- Models subclass `BaseModel` and expose `inference_methods` as `(prepare, run)` pairs. Each runs on its `device` (auto by default), and the service keeps a `ResourceManager` per GPU and per model on the CPU or an API, which runs `concurrency` calls at once: one on a GPU, whose models take turns; a CPU model's threads; a remote model's own. Each task has a `Scheduler`, which hands `run` batches of up to the model's `batch_size` (a GPU's `gpu.batch_size`, 1 on the CPU or the OpenAI API, an agy run's images), waiting up to `batch_latency` for one to fill, and keeps as many in flight as its resource runs, so with a `batch_size` of 1 the next request starts as each finishes. It prepares a batch (tokenizing, preprocessing) on a CPU thread, one at a time as tokenizers aren't thread-safe, before it waits for the resource. On the CPU, requests run side by side on executor threads (one torch thread each), so `run` must be thread-safe. A `remote` model's `run` is a coroutine on the event loop instead, without a `prepare`, so a call stops once its callers leave. `run` may give an `Exception` in place of a result that failed alone.
- A model holds at most two rounds (`Scheduler.capacity`: `batch_size` × `concurrency` requests), one running and one waiting; past that, the service turns away (`RESOURCE_EXHAUSTED`) a request with a deadline, as the server's tasks set, unless its caller (a connection) holds less than an even share of the model's requests (`InferenceService._admit`). A model turning requests away for now (`Busy`, as agy while its quota is spent) is answered so too. Schedulers drop what their callers left while they waited. The server's worker puts a task turned away so (an error with a `Busy() bool` method) back without counting an attempt, and runs fewer of its job type at once, so the backlog waits in its queue.
- `models.yaml` gives each role its model, `device`, and how it runs on a GPU (`gpu`: batching, precision) or the CPU (`cpu`: threads); `vlm.openai` sets the API's concurrency, and `vlm.agy` the agy CLI's batching and concurrency. The server keeps the stored embeddings (CLIP, and text for memes and tags) from the inference service's models: when one changes, it resizes their columns and queues `embed_meme` for the memes, which fills in what each lacks, its tags' from the VLM included (`EmbeddingService`). A restore queues it too once the site has adopted its models.
- The VLM in `models.yaml` may be a paid API: anything that triggers ingestion (uploads, reprocessing) costs money.

## Key Features
- **4-Way Recall**: Combines Metaphor (VLM), Semantic (VLM), CLIP (Visual), and OCR search results.
- **Reranking**: Re-scores candidates for better relevance.
- **Async Ingestion**: Uploads are processed in background workers.
