import Docker from "dockerode";
import { PassThrough } from "node:stream";
import type {
  ExecutionRequest,
  ExecutionResult,
  Executor,
} from "./executor.interface";
import { logger } from "../observability/logger";
import { captureAgentError, getErrorReporter } from "../observability/error-reporter";

/**
 * Factory Pattern: Resolves appropriate sandbox container image per tool or language.
 */
export class DockerImageFactory {
  private readonly imageMappings: Map<string, string> = new Map([
    ["node", "crucible-sandbox-node:latest"],
    ["nodejs", "crucible-sandbox-node:latest"],
    ["javascript", "crucible-sandbox-node:latest"],
    ["typescript", "crucible-sandbox-node:latest"],
    ["js", "crucible-sandbox-node:latest"],
    ["ts", "crucible-sandbox-node:latest"],
    ["python", "crucible-sandbox-python:latest"],
    ["python3", "crucible-sandbox-python:latest"],
    ["py", "crucible-sandbox-python:latest"],
    ["rust", "crucible-sandbox-rust:latest"],
    ["rs", "crucible-sandbox-rust:latest"],
    ["cargo", "crucible-sandbox-rust:latest"],
    ["bash", "crucible-sandbox-node:latest"],
    ["sh", "crucible-sandbox-node:latest"],
    ["default", "crucible-sandbox-node:latest"],
  ]);

  private readonly fallbackImages: Map<string, string> = new Map([
    ["node", "node:22-alpine"],
    ["python", "python:3.12-alpine"],
    ["rust", "rust:alpine"],
    ["default", "alpine:latest"],
  ]);

  constructor(customMappings?: Record<string, string>) {
    if (customMappings) {
      for (const [key, value] of Object.entries(customMappings)) {
        this.imageMappings.set(key.toLowerCase(), value);
      }
    }
  }

  resolveImage(
    language?: string,
    toolName?: string,
    explicitImage?: string
  ): string {
    if (explicitImage) {
      return explicitImage;
    }

    const key = (language || toolName || "default").toLowerCase();
    const mapped = this.imageMappings.get(key);
    if (mapped) {
      return mapped;
    }

    // Check partial matches
    if (key.includes("node") || key.includes("js") || key.includes("ts")) {
      return this.imageMappings.get("node")!;
    }
    if (key.includes("py")) {
      return this.imageMappings.get("python")!;
    }
    if (key.includes("rust") || key.includes("cargo")) {
      return this.imageMappings.get("rust")!;
    }

    return this.imageMappings.get("default") || "alpine:latest";
  }

  getFallbackImage(language?: string): string {
    const key = (language || "default").toLowerCase();
    return this.fallbackImages.get(key) || this.fallbackImages.get("default")!;
  }

  registerMapping(key: string, image: string): void {
    this.imageMappings.set(key.toLowerCase(), image);
  }
}

/**
 * Builder Pattern: Encapsulates creation of Dockerode ContainerCreateOptions.
 */
export class DockerContainerConfigBuilder {
  private options: Docker.ContainerCreateOptions = {
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
    Tty: false,
    OpenStdin: false,
    HostConfig: {
      AutoRemove: false,
      NetworkMode: "none",
      ReadonlyRootfs: false,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      Memory: 512 * 1024 * 1024, // 512MB default
      NanoCpus: 1_000_000_000, // 1.0 CPU default
    },
  };

  withImage(image: string): this {
    this.options.Image = image;
    return this;
  }

  withCommand(command: string | string[], shell = "/bin/sh"): this {
    if (Array.isArray(command)) {
      this.options.Cmd = command;
    } else {
      this.options.Cmd = [shell, "-c", command];
    }
    return this;
  }

  withWorkingDir(workingDir: string): this {
    this.options.WorkingDir = workingDir;
    return this;
  }

  withUser(user = "10001:10001"): this {
    this.options.User = user;
    return this;
  }

  withEnv(env?: Record<string, string>): this {
    if (!env) return this;
    this.options.Env = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    return this;
  }

  withMemoryLimit(bytes: number): this {
    if (this.options.HostConfig) {
      this.options.HostConfig.Memory = bytes;
    }
    return this;
  }

  withCpuLimit(nanoCpus: number): this {
    if (this.options.HostConfig) {
      this.options.HostConfig.NanoCpus = nanoCpus;
    }
    return this;
  }

  withNetworkMode(mode: "none" | "bridge" | "host" | string): this {
    if (this.options.HostConfig) {
      this.options.HostConfig.NetworkMode = mode;
    }
    return this;
  }

  withBinds(binds: string[]): this {
    if (this.options.HostConfig) {
      this.options.HostConfig.Binds = binds;
    }
    return this;
  }

  withLabels(labels: Record<string, string>): this {
    this.options.Labels = labels;
    return this;
  }

  build(): Docker.ContainerCreateOptions {
    if (!this.options.Image) {
      throw new Error("DockerContainerConfigBuilder: Image is required to build container config.");
    }
    return { ...this.options };
  }
}

export interface DockerExecutorConfig {
  docker?: Docker;
  socketPath?: string;
  host?: string;
  port?: number;
  imageFactory?: DockerImageFactory;
  defaultMemoryLimitBytes?: number;
  defaultCpuLimit?: number;
  defaultTimeoutMs?: number;
  defaultNetworkMode?: string;
  defaultUser?: string;
  maxBufferBytes?: number;
  fallbackExecutor?: Executor;
}

/**
 * Docker Executor (Compute Adapter Pattern)
 * Executes agent tool requests inside isolated, ephemeral Docker containers.
 */
export class DockerExecutor implements Executor {
  readonly name = "docker_container";
  private readonly docker: Docker;
  private readonly imageFactory: DockerImageFactory;
  private readonly defaultMemoryLimitBytes: number;
  private readonly defaultCpuLimit: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultNetworkMode: string;
  private readonly defaultUser: string;
  private readonly maxBufferBytes: number;
  private readonly fallbackExecutor?: Executor;

  constructor(config: DockerExecutorConfig = {}) {
    if (config.docker) {
      this.docker = config.docker;
    } else if (config.socketPath) {
      this.docker = new Docker({ socketPath: config.socketPath });
    } else if (config.host) {
      this.docker = new Docker({ host: config.host, port: config.port || 2375 });
    } else {
      const defaultSocket =
        process.platform === "win32"
          ? "//./pipe/docker_engine"
          : "/var/run/docker.sock";
      this.docker = new Docker({ socketPath: defaultSocket });
    }

    this.imageFactory = config.imageFactory || new DockerImageFactory();
    this.defaultMemoryLimitBytes =
      config.defaultMemoryLimitBytes || 512 * 1024 * 1024; // 512 MB
    this.defaultCpuLimit = config.defaultCpuLimit || 1_000_000_000; // 1.0 CPU
    this.defaultTimeoutMs = config.defaultTimeoutMs || 30_000;
    this.defaultNetworkMode = config.defaultNetworkMode || "none";
    this.defaultUser = config.defaultUser || "10001:10001";
    this.maxBufferBytes = config.maxBufferBytes || 10 * 1024 * 1024; // 10 MB
    this.fallbackExecutor = config.fallbackExecutor;
  }

  /**
   * Check if Docker daemon is accessible and responding
   */
  async isAvailable(): Promise<boolean> {
    try {
      const pingResult = await this.docker.ping();
      return pingResult === "OK" || Buffer.isBuffer(pingResult);
    } catch {
      return false;
    }
  }

  /**
   * Execute command inside disposable Docker container
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const memoryLimit = request.memoryLimitBytes ?? this.defaultMemoryLimitBytes;
    const cpuLimit = request.cpuLimit ?? this.defaultCpuLimit;

    // Check Docker daemon availability; fallback if configured
    const available = await this.isAvailable();
    if (!available) {
      if (this.fallbackExecutor) {
        logger.warn(
          { command: request.command },
          "[DockerExecutor] Docker daemon unavailable, falling back to secondary executor"
        );
        return this.fallbackExecutor.execute(request);
      }
      const errMsg = "Docker daemon is unreachable at configured socket/host.";
      captureAgentError(new Error(errMsg), {
        sessionId: request.sessionId,
        toolName: request.toolName,
        extra: { executor: this.name, errorType: "DOCKER_DAEMON_UNAVAILABLE" },
      });
      return {
        exitCode: 1,
        stdout: "",
        stderr: errMsg,
        durationMs: Date.now() - startTime,
        killed: false,
      };
    }

    const image = this.imageFactory.resolveImage(
      request.language,
      request.toolName,
      request.image
    );

    const builder = new DockerContainerConfigBuilder()
      .withImage(image)
      .withCommand(request.command)
      .withWorkingDir(request.cwd || "/workspace")
      .withUser(this.defaultUser)
      .withMemoryLimit(memoryLimit)
      .withCpuLimit(cpuLimit)
      .withNetworkMode(this.defaultNetworkMode)
      .withEnv(request.env)
      .withLabels({
        "crucible.managed": "true",
        "crucible.session": request.sessionId || "default",
        "crucible.timestamp": String(Date.now()),
      });

    let container: Docker.Container | null = null;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let killed = false;
    let timer: NodeJS.Timeout | null = null;

    try {
      const containerConfig = builder.build();
      container = await this.docker.createContainer(containerConfig);

      // Attach stdout/stderr streams before start
      const attachStream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      stdoutStream.on("data", (chunk: Buffer) => {
        if (stdoutBuffer.length < this.maxBufferBytes) {
          stdoutBuffer += chunk.toString("utf8");
        }
      });

      stderrStream.on("data", (chunk: Buffer) => {
        if (stderrBuffer.length < this.maxBufferBytes) {
          stderrBuffer += chunk.toString("utf8");
        }
      });

      this.docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);

      // Start container execution
      await container.start();

      // Execution timeout handler
      if (timeoutMs > 0) {
        timer = setTimeout(async () => {
          killed = true;
          try {
            await container?.stop({ t: 1 });
          } catch {
            await container?.kill().catch(() => {});
          }
        }, timeoutMs);
      }

      // AbortSignal listener
      if (request.signal) {
        request.signal.addEventListener("abort", async () => {
          killed = true;
          try {
            await container?.stop({ t: 1 });
          } catch {
            await container?.kill().catch(() => {});
          }
        });
      }

      // Wait for container process completion
      const waitResult = await container.wait();
      if (timer) clearTimeout(timer);

      // Inspect container state for exitCode, OOM, and memory status
      const inspectData = await container.inspect();
      const exitCode = waitResult.StatusCode ?? inspectData.State?.ExitCode ?? (killed ? 137 : 0);
      const oomKilled = inspectData.State?.OOMKilled ?? false;
      const durationMs = Date.now() - startTime;
      const containerId = inspectData.Id?.substring(0, 12) || container.id;

      const result: ExecutionResult = {
        exitCode,
        stdout: stdoutBuffer.trimEnd(),
        stderr: stderrBuffer.trimEnd(),
        durationMs,
        killed,
        oomKilled,
        containerId,
        image,
      };

      // Capture container-level failures in ErrorReporter
      if (oomKilled) {
        const oomMsg = `Container ${containerId} killed due to Out-Of-Memory (limit: ${memoryLimit} bytes)`;
        getErrorReporter().captureContainerFailure({
          containerId,
          image,
          exitCode: 137,
          oomKilled: true,
          memoryLimitBytes: memoryLimit,
          reason: "CONTAINER_OOM_KILLED",
          sessionId: request.sessionId,
          toolName: request.toolName,
        });
      } else if (exitCode !== 0 && !killed) {
        getErrorReporter().captureContainerFailure({
          containerId,
          image,
          exitCode,
          oomKilled: false,
          reason: "CONTAINER_NON_ZERO_EXIT",
          stderr: result.stderr,
          sessionId: request.sessionId,
          toolName: request.toolName,
        });
      } else if (killed) {
        getErrorReporter().captureContainerFailure({
          containerId,
          image,
          exitCode: 137,
          oomKilled: false,
          reason: "CONTAINER_TIMEOUT",
          sessionId: request.sessionId,
          toolName: request.toolName,
        });
      }

      return result;
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { err: error, command: request.command, image },
        `[DockerExecutor] Container execution failed: ${error.message}`
      );

      captureAgentError(error, {
        sessionId: request.sessionId,
        toolName: request.toolName,
        extra: { executor: this.name, image },
      });

      return {
        exitCode: 1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer || error.message,
        durationMs: Date.now() - startTime,
        killed,
        image,
      };
    } finally {
      // Ephemeral cleanup: Remove container unconditionally
      if (container) {
        try {
          await container.remove({ force: true, v: true });
        } catch {
          // Discard container cleanup errors
        }
      }
    }
  }
}
