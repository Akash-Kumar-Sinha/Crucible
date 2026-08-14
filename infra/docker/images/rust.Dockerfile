# Crucible Minimal Rust Sandbox Base Image
FROM rust:alpine

# Install essential build dependencies
RUN apk add --no-cache musl-dev && \
    addgroup -S -g 10001 crucible && \
    adduser -S -u 10001 -G crucible -s /bin/sh -h /workspace crucible && \
    mkdir -p /workspace && \
    chown -R crucible:crucible /workspace

WORKDIR /workspace
USER crucible

# Default execution shell
CMD ["/bin/sh"]
