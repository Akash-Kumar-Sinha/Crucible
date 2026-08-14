# Crucible

> High-performance Agent Harness and Reasoning Orchestration Platform.

Crucible implements an autonomous **Thought-Action-Observation** loop built on an explicit finite state machine with swappable LLM provider strategies and strict Zod validation envelopes.

## Quick Start

### 1. Environment Setup

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY="your-openrouter-api-key"
```

### 2. Install & Build

```bash
make install
make build
```

### 3. Run Tests

```bash
# Run fast unit tests with Turbo caching
make test

# Run live integration test against OpenRouter free tier
make test-live

# Run all test suites
make test-all
```

### 4. Run Orchestrator Demo

```bash
make run
```

## Common Commands

| Command          | Description                          |
| :--------------- | :----------------------------------- |
| `make build`     | Build all workspaces                 |
| `make test`      | Run cached unit tests                |
| `make test-live` | Run live OpenRouter integration test |
| `make check`     | Typecheck TypeScript codebase        |
| `make dev`       | Start development watcher            |
| `make fmt`       | Format codebase                      |
