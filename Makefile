.PHONY: help default install build test test-unit test-rust test-live check start serve web run cli demo fmt clean

default: help

help:
	@echo "Crucible Development & Task Runner"
	@echo ""
	@echo "Development & Execution:"
	@echo "  make start       - Start backend orchestrator (port 4000) & frontend (port 3000) concurrently"
	@echo "  make serve       - Start core orchestrator HTTP REST server on port 4000"
	@echo "  make web         - Start Next.js web UI on port 3000"
	@echo "  make demo        - Run full system verification suite (demos across all subsystems)"
	@echo "  make run         - Run local orchestrator Thought-Action-Observation demo"
	@echo "  make cli         - Run interactive Local Executor CLI demo"
	@echo ""
	@echo "Build & Quality:"
	@echo "  make install     - Install monorepo dependencies across workspaces"
	@echo "  make build       - Build all packages and applications (Turborepo + Cargo)"
	@echo "  make check       - Run typechecks and syntax verification (TypeScript + Rust)"
	@echo "  make fmt         - Format all code (Prettier for TS/JSON + cargo fmt for Rust)"
	@echo "  make clean       - Clean all build outputs, caches, and Cargo target directory"
	@echo ""
	@echo "Testing:"
	@echo "  make test        - Run all test suites across the repository (Bun/Turborepo + Cargo)"
	@echo "  make test-unit   - Run fast local unit tests directly via Bun (offline)"
	@echo "  make test-rust   - Run Rust execution-core unit tests directly via Cargo"
	@echo "  make test-live   - Run live OpenRouter integration test"

# -------------------------------------------------------------
# Development & Execution
# -------------------------------------------------------------
start:
	bunx turbo run dev

serve:
	bun apps/orchestrator/src/http/server.ts

web:
	bun run --cwd apps/web dev

demo:
	bun apps/orchestrator/src/demo/run-all-demos.ts

run:
	bun apps/orchestrator/src/index.ts

cli:
	bun apps/orchestrator/src/cli/run-local.ts

# -------------------------------------------------------------
# Build & Quality
# -------------------------------------------------------------
install:
	bun install
	bun run --cwd apps/orchestrator prisma generate

build:
	bun run --cwd apps/orchestrator prisma generate
	bunx turbo run build
	cargo build

check:
	bunx turbo run typecheck
	cargo check

fmt:
	bunx prettier --write "apps/**/*.{ts,tsx,json}" "packages/**/*.{ts,tsx,json}" "*.json"
	cargo fmt
	cargo clippy

update:
	bun update
	
clean:
	rm -rf .turbo dist apps/*/dist packages/*/dist target

# -------------------------------------------------------------
# Testing
# -------------------------------------------------------------
test:
	bun test
	cargo test

test-unit:
	bun test packages apps/orchestrator/src/session apps/orchestrator/src/http apps/orchestrator/src/observability apps/orchestrator/src/tools apps/orchestrator/src/execution apps/orchestrator/src/agent/loop.test.ts apps/web/src/lib

test-rust:
	cargo test

test-live:
	bun test apps/orchestrator/src/agent/openrouter.integration.test.ts
