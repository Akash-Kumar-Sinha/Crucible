FROM rust:1.85-bookworm AS builder

WORKDIR /usr/src/crucible

RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN cargo build --release -p executor-grpc

FROM debian:bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    netcat-traditional \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/crucible/target/release/executor-grpc /usr/local/bin/executor-grpc

EXPOSE 50051

ENV CRUCIBLE_GRPC_PORT=50051 \
    RUST_LOG=info

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD nc -z 127.0.0.1 50051 || exit 1

ENTRYPOINT ["/usr/local/bin/executor-grpc"]
