FROM oven/bun:latest AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared-schemas ./packages/shared-schemas
COPY apps/web ./apps/web

RUN bun install --ignore-scripts

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app/apps/web
RUN bun run build

WORKDIR /app

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["bun", "run", "--cwd", "apps/web", "start"]
