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
    - **Role**: The site and the admin console; reaches the server through the `/api` rewrite.

## Directory Structure

```
MemeDB/
├── protos/             # Protobuf definitions
├── server/             # Go Backend
│   ├── cmd/            # Entry points
│   ├── internal/       # Application logic
│   │   ├── config/     # Configuration
│   │   ├── handler/    # HTTP Handlers
│   │   ├── service/    # Business Logic
│   │   ├── repository/ # Data Access
│   │   └── worker/     # Async Worker
│   ├── tests/          # Integration & Unit Tests
│   └── sql/            # DB Schema
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

### Database & Transaction Management
- **Repository Pattern**: Repositories must focus solely on data access and query execution.
- **DB Interface**: Repositories must accept a `db.DBTX` interface in their constructors. They must NOT manage transactions internally.
- **Transaction Management**:
  - Transactions must be managed at the Service layer using the `repository.Provider`.
  - For simple queries, use the default repositories provided by the `Provider` (e.g., `s.repo.User.Get`).
  - For multiple operations requiring atomicity, use the `Transaction` helper (`Provider.Tx`).
- **Access Control**: Enforced explicitly in repository queries (owner / visibility filters); there is no row-level security. A node is public if it or an ancestor folder is public (`library.public_files`).
- **API Tokens**: Requests authenticate with a session JWT or a personal API token (`mdb_…`), whose scope `rbac` enforces: `read` tokens may only GET signed-in routes, the admin API needs the `admin` scope, and routes under `rbac.RequireSession()` (password, tokens) refuse tokens altogether.
- **Schema**: `server/sql/init.sql` creates the database.

### Protobuf Workflow
- **Definition**: Protocol buffers are defined in `protos/`.
- **Generation**: Run `make gen-proto` in the root directory to regenerate Go and Python code after modifying `.proto` files.
  - This updates `server/internal/pb/` (Go) and `inference/app/pb/` (Python).

### Error Handling
- **Service Layer**: Services should return `apperror` types (from `server/internal/pkg/apperror`) for expected errors (e.g., `apperror.NotFound`, `apperror.BadRequest`). Unexpected internal errors should be returned as raw `error`, which will default to an Internal Server Error (500) in the handler.
- **Handler Layer**: Handlers should simply return the error from the service layer. Avoid manual `c.JSON` or `c.String` for error responses.

### Web
- Read `web/AGENTS.md` first: this Next.js version differs from what you may know.
- Build UI from `components/ui` and the theme tokens in `app/globals.css`; fetch with SWR through `lib/api`, calling `refresh()` after mutations.
- Keep `lib/types.ts` in sync with the server's JSON, and the API reference in `components/api-docs.tsx` with the routes.

### Inference Service
- Models subclass `BaseModel` and expose `inference_methods`. GPU models are batched by `BatchScheduler`; the others run on `SimpleScheduler` executor threads, so their code must be thread-safe.
- The VLM in `models.yaml` may be a paid API: anything that triggers ingestion (uploads, reprocessing) costs money.

## Key Features
- **4-Way Recall**: Combines Metaphor (VLM), Semantic (VLM), CLIP (Visual), and OCR search results.
- **Reranking**: Re-scores candidates for better relevance.
- **Async Ingestion**: Uploads are processed in background workers.
