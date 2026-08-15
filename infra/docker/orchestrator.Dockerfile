FROM oven/bun:latest AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared-schemas ./packages/shared-schemas
COPY packages/proto-types ./packages/proto-types
COPY crates/ipc-proto/proto ./crates/ipc-proto/proto
COPY apps/orchestrator ./apps/orchestrator

RUN bun install --ignore-scripts

WORKDIR /app/apps/orchestrator
RUN bunx prisma generate

WORKDIR /app

EXPOSE 4000

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["bun", "apps/orchestrator/src/http/server.ts"]
