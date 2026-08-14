.PHONY: help default install build test test-unit test-live test-all check start serve web run cli fmt clean

default: help

help:
	@echo "Available targets:"
	@echo "  make start      - Run backend orchestrator and frontend web UI concurrently"
	@echo "  make serve      - Start the Core Orchestrator HTTP REST Server on port 4000"
	@echo "  make web        - Start the Next.js Web UI on port 3000"
	@echo "  make install    - Install all workspace dependencies"
	@echo "  make build      - Build all applications and packages via Turborepo"
	@echo "  make test       - Run cached unit tests across workspaces via Turborepo"
	@echo "  make test-unit  - Run fast local unit tests directly via Bun (no network required)"
	@echo "  make test-live  - Run live OpenRouter integration tests with free-tier model"
	@echo "  make test-all   - Run all test suites across the repository"
	@echo "  make check      - Run typechecking across all workspaces"
	@echo "  make run        - Run the orchestrator demo"
	@echo "  make cli        - Run the Local Executor CLI demo"
	@echo "  make fmt        - Format codebase using prettier"
	@echo "  make clean      - Clean build artifacts and Turbo cache"

install:
	bun install

build:
	bunx turbo run build

test:
	bunx turbo run test

test-unit:
	bun test packages apps/orchestrator/src/session apps/orchestrator/src/http apps/orchestrator/src/observability apps/orchestrator/src/tools apps/orchestrator/src/execution apps/orchestrator/src/agent/loop.test.ts apps/web/src/lib

test-live:
	bun test apps/orchestrator/src/agent/openrouter.integration.test.ts

test-all:
	bun test

check:
	bunx turbo run typecheck

start:
	bunx turbo run dev

run:
	bun apps/orchestrator/src/index.ts

cli:
	bun apps/orchestrator/src/cli/run-local.ts

serve:
	bun apps/orchestrator/src/http/server.ts

web:
	bun run --cwd apps/web dev

fmt:
	bunx prettier --write "apps/**/*.{ts,tsx,json}" "*.json"

clean:
	rm -rf .turbo dist apps/*/dist packages/*/dist
