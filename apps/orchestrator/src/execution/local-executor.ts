import { spawn } from "node:child_process";
import type {
  ExecutionRequest,
  ExecutionResult,
  Executor,
} from "./executor.interface";

export interface LocalExecutorConfig {
  defaultCwd?: string;
  defaultTimeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
  shell?: string;
}

/**
 * Local Subprocess Executor
 * Executes shell commands locally using child_process.spawn.
 */
export class LocalExecutor implements Executor {
  readonly name = "local_subprocess";
  private readonly defaultCwd: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly env: Record<string, string>;
  private readonly shell: string;

  constructor(config: LocalExecutorConfig = {}) {
    this.defaultCwd = config.defaultCwd || process.cwd();
    this.defaultTimeoutMs = config.defaultTimeoutMs || 30_000;
    this.maxBufferBytes = config.maxBufferBytes || 10 * 1024 * 1024; // 10MB
    this.env = config.env || {};
    this.shell = config.shell || "/bin/bash";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const cwd = request.cwd || this.defaultCwd;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let timer: NodeJS.Timeout | undefined;

      // Merge environment variables
      const procEnv = {
        ...process.env,
        ...this.env,
        ...request.env,
      };

      const child = spawn(this.shell, ["-c", request.command], {
        cwd,
        env: procEnv,
      });

      // Timeout handler
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          killed = true;
          child.kill("SIGTERM");
          // Force kill if not exited after 2s
          setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2000);
        }, timeoutMs);
      }

      // AbortSignal cancellation listener
      if (request.signal) {
        request.signal.addEventListener("abort", () => {
          killed = true;
          child.kill("SIGTERM");
        });
      }

      child.stdout?.on("data", (data: Buffer) => {
        if (stdout.length < this.maxBufferBytes) {
          stdout += data.toString("utf8");
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < this.maxBufferBytes) {
          stderr += data.toString("utf8");
        }
      });

      (child as any).on("error", (err: Error) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr || err.message,
          durationMs: Date.now() - startTime,
          killed,
        });
      });

      (child as any).on("close", (code: number | null) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: code ?? (killed ? 137 : 0),
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          durationMs: Date.now() - startTime,
          killed,
        });
      });
    });
  }
}
