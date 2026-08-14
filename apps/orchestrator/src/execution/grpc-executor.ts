import * as grpc from "@grpc/grpc-js";
import {
  createExecutorClient,
  type ExecutorServiceClient,
  type ExecuteResponse,
} from "@crucible/proto-types";
import type {
  Executor,
  ExecutionRequest,
  ExecutionResult,
} from "./executor.interface";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";

import { tracer } from "../observability/otel";

export interface GrpcExecutorConfig {
  address?: string;
  credentials?: grpc.ChannelCredentials;
  fallbackExecutor?: Executor;
  defaultTimeoutMs?: number;
}

/**
 * Rust gRPC Executor Adapter (Facade Pattern)
 *
 * Provides a high-performance typed gRPC channel into the Rust executor core.
 */
export class GrpcExecutor implements Executor {
  readonly name = "rust_grpc";
  private readonly address: string;
  private readonly client: ExecutorServiceClient;
  private readonly fallbackExecutor?: Executor;
  private readonly defaultTimeoutMs: number;
  private readonly log = logger.child({
    module: "grpc-executor",
  });

  constructor(config: GrpcExecutorConfig = {}) {
    this.address =
      config.address || process.env.CRUCIBLE_GRPC_ADDR || "127.0.0.1:50051";
    this.client = createExecutorClient(
      this.address,
      config.credentials || grpc.credentials.createInsecure(),
    );
    this.fallbackExecutor = config.fallbackExecutor;
    this.defaultTimeoutMs = config.defaultTimeoutMs || 30_000;
  }

  /**
   * Pings the Rust gRPC server and verifies whether the service is reachable and ready.
   */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const deadline = new Date(Date.now() + 1500);
      this.client.waitForReady(deadline, (error?: Error) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Executes a command on the Rust compute core over gRPC.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return tracer.withSpan(
      "grpc.rust_executor",
      {
        sessionId: request.sessionId,
        toolName: request.toolName,
        command: request.command,
        address: this.address,
      },
      async (span) => {
        const isReady = await this.isAvailable();

        if (!isReady) {
          if (this.fallbackExecutor) {
            this.log.warn(
              { address: this.address, fallback: this.fallbackExecutor.name },
              "Rust gRPC executor unavailable; falling back to secondary executor",
            );
            return this.fallbackExecutor.execute(request);
          }

          const errMsg = `Rust gRPC executor at '${this.address}' is unavailable and no fallback configured.`;
          getErrorReporter().captureAgentError(new Error(errMsg), {
            toolName: request.toolName,
            sessionId: request.sessionId,
            extra: { address: this.address, command: request.command },
          });

          return {
            exitCode: 1,
            stdout: "",
            stderr: errMsg,
            durationMs: 0,
            killed: false,
          };
        }

        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        const deadline = new Date(Date.now() + timeoutMs + 2000);

        const env = {
          ...(request.env || {}),
          TRACEPARENT: span.getTraceparent(),
        };

        return new Promise<ExecutionResult>((resolve) => {
          const callOptions: grpc.CallOptions = { deadline };

          this.client.Execute(
            {
              command: "sh",
              args: ["-c", request.command],
              working_dir: request.cwd,
              env,
              timeout_ms: timeoutMs,
              session_id: request.sessionId,
              tool_name: request.toolName,
            },
            callOptions,
            (err: grpc.ServiceError | null, response?: ExecuteResponse) => {
              if (err) {
                const isTimeout = err.code === grpc.status.DEADLINE_EXCEEDED;
                span.setAttribute("error", err.message);
                span.setAttribute("grpcCode", err.code);

                this.log.error(
                  {
                    errCode: err.code,
                    errMsg: err.message,
                    command: request.command,
                  },
                  "Rust gRPC execution failed",
                );

                getErrorReporter().captureAgentError(err, {
                  toolName: request.toolName,
                  sessionId: request.sessionId,
                  extra: {
                    grpcCode: err.code,
                    command: request.command,
                    address: this.address,
                  },
                });

                resolve({
                  exitCode: isTimeout ? 137 : 1,
                  stdout: "",
                  stderr: isTimeout
                    ? `Execution timed out after ${timeoutMs}ms`
                    : `gRPC error (${err.code}): ${err.message}`,
                  durationMs: timeoutMs,
                  killed: isTimeout,
                });
                return;
              }

              if (!response) {
                span.setAttribute("error", "Empty response");
                resolve({
                  exitCode: 1,
                  stdout: "",
                  stderr: "Empty gRPC response received from executor",
                  durationMs: 0,
                  killed: false,
                });
                return;
              }

              span.setAttribute("exitCode", response.exit_code);
              span.setAttribute("durationMs", Number(response.duration_ms));

              resolve({
                exitCode: response.exit_code,
                stdout: response.stdout,
                stderr: response.stderr,
                durationMs: Number(response.duration_ms),
                killed: response.timed_out,
              });
            },
          );
        });
      },
    );
  }

  /**
   * Gracefully close client channel.
   */
  close(): void {
    this.client.close();
  }
}
