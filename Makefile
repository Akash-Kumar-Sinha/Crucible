.PHONY: help default install build test test-live test-all check dev run fmt clean

default: help

help:
	@echo "Available targets:"
	@echo "  make install    - Install all workspace dependencies"
	@echo "  make build      - Build all applications and packages via Turborepo"
	@echo "  make test       - Run fast unit tests across workspaces via Turborepo"
	@echo "  make test-live  - Run live OpenRouter integration tests with free-tier model"
	@echo "  make test-all   - Run all unit and live integration tests"
	@echo "  make check      - Run typechecking across all workspaces"
	@echo "  make dev        - Run development watcher"
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

test-live:
	bun test apps/orchestrator/src/agent/openrouter.integration.test.ts

test-all:
	bun test

check:
	bunx turbo run typecheck

dev:
	bunx turbo run dev

run:
	bun apps/orchestrator/src/index.ts

cli:
	bun apps/orchestrator/src/cli/run-local.ts

fmt:
	bunx prettier --write "apps/**/*.{ts,tsx,json}" "*.json"

clean:
	rm -rf .turbo dist apps/*/dist packages/*/dist
