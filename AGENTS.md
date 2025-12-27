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
    - **Role**: Provides embedding generation (CLIP, Text) and Reranking services.

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

### Go Server
- **Surgical Changes**: Do NOT make any changes outside the explicit scope of the task. ALWAYS clean up obsolete code (e.g., unused functions, structs) resulting from the refactoring required by the task.
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
  - For multiple operations requiring atomicity, use the `Transaction` helper.

### Protobuf Workflow
- **Definition**: Protocol buffers are defined in `protos/`.
- **Generation**: Run `make gen-proto` in the root directory to regenerate Go and Python code after modifying `.proto` files.
  - This updates `server/internal/pb/` (Go) and `inference/app/pb/` (Python).

### Error Handling
- **Service Layer**: Services should return `apperror` types (from `server/internal/pkg/apperror`) for expected errors (e.g., `apperror.NotFound`, `apperror.BadRequest`). Unexpected internal errors should be returned as raw `error`, which will default to an Internal Server Error (500) in the handler.
- **Handler Layer**: Handlers should simply return the error from the service layer. Avoid manual `c.JSON` or `c.String` for error responses.

## Key Features
- **4-Way Recall**: Combines Metaphor (VLM), Semantic (VLM), CLIP (Visual), and OCR search results.
- **Reranking**: Re-scores candidates for better relevance.
- **Async Ingestion**: Uploads are processed in background workers.
