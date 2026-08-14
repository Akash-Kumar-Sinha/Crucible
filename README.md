# Crucible

> High-performance, self-hostable AI agent execution harness and reasoning orchestrator.

Crucible implements an autonomous **Thought-Action-Observation** loop built on an explicit finite state machine with swappable LLM provider strategies, strict Zod validation envelopes, multi-tier compute isolation, real-time event streaming, and durable state persistence.

---

## 🏛️ Architecture Overview

```mermaid
flowchart TB
    subgraph Frontend["Web UI (Next.js - Port 3000)"]
        UI[Chat Window & LiveOutput]
        Sidebar[Session Sidebar]
        StreamClient[SessionStreamClient SSE / WS]
    end

    subgraph Orchestrator["Reasoning Orchestrator (Bun / TypeScript - Port 4000)"]
        HTTP[REST Router & Health Probes]
        WS[WebSocket & SSE Streaming Gateway]
        SM[SessionManager & Stateful Actor Loop]
        FSM[AgentStateMachine]
        OpenRouter[Unified OpenRouter Provider]
        Tools[Tool Registry: bash, read_file, calc, time]
    end

    subgraph Persistence["State & Session Persistence"]
        PG[(PostgreSQL - Prisma ORM)]
        EventStore[Event Sourcing Run History]
        Redis[(Redis Hot State Cache)]
    end

    subgraph ExecutionTiers["Sandboxed Compute & Execution Core (Rust)"]
        Local[Local Subprocess Executor]
        Docker[Dockerode Hardened Container]
        GrpcClient[Typed gRPC IPC Client]
        GrpcServer[Tonic gRPC Service - Port 50051]
        Cgroups[cgroups v2 Resource Isolation]
        OverlayFS[OverlayFS Ephemeral Union Mounts]
        Netns[Network Namespaces & nftables Egress Policy]
    end

    UI <-->|SSE / WebSocket| WS
    UI <-->|HTTP REST| HTTP
    HTTP --> SM
    SM --> FSM
    FSM --> OpenRouter
    FSM --> Tools
    Tools --> Local
    Tools --> Docker
    Tools --> GrpcClient
    GrpcClient <-->|Protobuf / TCP| GrpcServer
    GrpcServer --> Cgroups
    GrpcServer --> OverlayFS
    GrpcServer --> Netns
    SM <-->|Repository Pattern| PG
    SM <-->|Append-Only Events| EventStore
    SM <-->|Hot TTL Cache| Redis
```

---

## 🚀 Key Subsystems

1. **State Machine & Loop Harness** (`apps/orchestrator/src/agent/`):
   - Autonomous ReAct Thought-Action-Observation loop.
   - States: `awaiting_model`, `awaiting_tool`, `awaiting_human`, `done`, `error`.
   - Reusable thought parser and unified OpenRouter provider gateway.

2. **Sandboxed Compute & Isolation Core** (`crates/sandbox/`, `crates/executor-core/`, `crates/executor-grpc/`):
   - **cgroups v2**: Strict enforcement of `cpu.max`, `memory.max`, `pids.max` with guaranteed RAII teardown.
   - **OverlayFS**: Ephemeral Copy-on-Write union filesystems for atomic workspaces with zero cross-talk.
   - **Network Policy & Egress Control**: Deny-by-default airgap policies with declarative stateful `nftables` rulesets and granular allowlists.
   - **High-Throughput gRPC IPC**: Native Tonic gRPC server communicating over protobuf contracts.

3. **State & Session Persistence** (`apps/orchestrator/src/persistence/`):
   - **PostgreSQL via Prisma ORM**: Durable relational storage for `Session`, `Turn`, and `ToolCall` records.
   - **Event Sourcing**: Append-only domain event stream (`RunEvent`) with full history replay.
   - **Redis Hot State Cache**: Sub-millisecond active session state caching and TTL markers.
   - **Crash Recovery**: `SessionManager.restoreFromPersistence()` rehydrates active sessions across server restarts.

4. **Real-Time Streaming** (`apps/orchestrator/src/streaming/` & `apps/web/`):
   - Non-buffered token-by-token and tool stdout/stderr chunk streaming via Server-Sent Events (SSE) and WebSockets.
   - Per-session topic fanout ensuring complete stream isolation across parallel running sessions.

5. **Observability & Health Probes** (`apps/orchestrator/src/observability/`):
   - Fast structured JSON logging via Pino & Pino-Pretty.
   - `GET /healthz` (liveness) and `GET /readyz` (readiness) probing OpenRouter, Docker, gRPC, disk, PostgreSQL, and Redis.
   - Observer pattern error reporting with dedicated security alerts (`CRUCIBLE_NETWORK_SECURITY_INCIDENT_ALERT`, `CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT`).

---

## ⚡ Quick Start

### 1. Environment Setup

Create a `.env` file in the project root:

```bash
# LLM Provider Gateway
OPENROUTER_API_KEY="your-openrouter-api-key"
OPENROUTER_MODEL="nvidia/nemotron-3-nano-30b-a3b:free"

# State & Session Persistence
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crucible?schema=public"
REDIS_URL="redis://127.0.0.1:6379"

# Execution Mode (docker | local | grpc)
CRUCIBLE_EXECUTOR="docker"
CRUCIBLE_GRPC_ADDR="127.0.0.1:50051"
```

### 2. Install & Build

```bash
make install
make build
```

### 3. Apply Database Migrations

```bash
# Push schema or apply migrations via Prisma
bun run --cwd apps/orchestrator prisma db push
```

### 4. Run Development Stack

```bash
# Start backend orchestrator (port 4000) & Next.js frontend (port 3000) concurrently
make start
```

Or run services individually:

```bash
make serve   # Core orchestrator HTTP REST server on port 4000
make web     # Next.js web UI on port 3000
make cli     # Interactive Local Executor CLI REPL
```

---

## 🧪 Testing & Verification

```bash
make check       # Typecheck TypeScript & verify Rust crates
make test        # Run all test suites across the monorepo (Bun + Cargo)
make test-unit   # Run fast offline TypeScript unit tests
make test-rust   # Run Rust unit & integration test suites
make test-live   # Run live OpenRouter integration tests
```

---

## 📋 Task Runner Reference

| Command          | Description                                                    |
| :--------------- | :------------------------------------------------------------- |
| `make start`     | Start backend (port 4000) and web frontend (port 3000)         |
| `make serve`     | Start HTTP REST server on port 4000                            |
| `make web`       | Start Next.js web application on port 3000                     |
| `make install`   | Install monorepo dependencies and generate Prisma client       |
| `make build`     | Build packages & applications (Turborepo + Cargo)              |
| `make check`     | Run typechecks and syntax verification across TS & Rust        |
| `make test`      | Run full monorepo test suite (81 TS tests + 27 Rust tests)     |
| `make test-unit` | Run fast offline TypeScript unit tests                         |
| `make test-rust` | Run Cargo tests for executor-core, executor-grpc, and sandbox  |
| `make test-live` | Run live OpenRouter integration test                           |
| `make cli`       | Launch interactive command-line REPL harness                   |
| `make fmt`       | Format codebase (Prettier for TS/JSON + `cargo fmt` for Rust)  |
| `make clean`     | Clean build caches, outputs, and Cargo target directory        |
