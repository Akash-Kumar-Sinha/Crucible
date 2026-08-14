# Crucible Minimal Python Sandbox Base Image
FROM python:3.12-alpine

# Set non-root execution context
RUN addgroup -S -g 10001 crucible && \
    adduser -S -u 10001 -G crucible -s /bin/sh -h /workspace crucible && \
    mkdir -p /workspace && \
    chown -R crucible:crucible /workspace

WORKDIR /workspace
USER crucible

# Default execution shell
CMD ["/bin/sh"]
