import { promises as fs, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import type Docker from "dockerode";
import type { Executor } from "../execution/executor.interface";
import type { OpenRouterProvider } from "../provider/openrouter";

export interface DependencyCheck {
  status: "ok" | "degraded" | "failed";
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  system?: {
    memoryMb: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
    pid: number;
    runtime: string;
    dockerSocketPresent?: boolean;
    grpcStatus?: "online" | "down";
  };
  checks?: Record<string, DependencyCheck>;
}

export interface ReadinessCheckOptions {
  provider?: OpenRouterProvider;
  executor?: Executor;
  docker?: Docker;
  grpcAddress?: string;
  checkOpenRouter?: () => Promise<boolean>;
  checkExecutor?: () => Promise<boolean>;
  checkDocker?: () => Promise<boolean>;
  checkGrpc?: () => Promise<boolean>;
  checkDisk?: () => Promise<boolean>;
  checkKubernetes?: () => Promise<boolean>;
  checkPostgres?: () => Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }>;
  checkRedis?: () => Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }>;
  timeoutMs?: number;
}

export async function pingTcpPort(
  host: string,
  port: number,
  timeoutMs: number = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      resolved = true;
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.once("error", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
}

export function performLivenessCheck(): HealthCheckResponse {
  const mem = process.memoryUsage();
  const rssMb = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
  const heapTotalMb = Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100;
  const heapUsedMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;

  const isHealthy = rssMb < 2048;
  const socketPath =
    process.platform === "win32"
      ? "//./pipe/docker_engine"
      : "/var/run/docker.sock";
  const dockerSocketPresent = existsSync(socketPath);

  return {
    status: isHealthy ? "healthy" : "unhealthy",
    service: "crucible-orchestrator",
    version: "0.1.0",
    uptime: Math.round(process.uptime() * 100) / 100,
    timestamp: new Date().toISOString(),
    system: {
      memoryMb: {
        rss: rssMb,
        heapTotal: heapTotalMb,
        heapUsed: heapUsedMb,
      },
      pid: process.pid,
      runtime:
        typeof Bun !== "undefined"
          ? `bun/${Bun.version}`
          : `node/${process.version}`,
      dockerSocketPresent,
    },
  };
}

export async function performReadinessCheck(
  options: ReadinessCheckOptions = {},
): Promise<{ statusCode: number; body: HealthCheckResponse }> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const checks: Record<string, DependencyCheck> = {};
  let overallHealthy = true;

  // 1. Process Loop Liveness
  const liveness = performLivenessCheck();
  checks["orchestrator_loop"] = {
    status: liveness.status === "healthy" ? "ok" : "failed",
    latencyMs: 1,
  };
  if (liveness.status !== "healthy") {
    overallHealthy = false;
  }

  // 2. OpenRouter Gateway Check
  const checkOpenRouterFn =
    options.checkOpenRouter ||
    (async () => {
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER;
      if (!apiKey) {
        return false;
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok;
      } catch {
        return false;
      }
    });

  const t0 = performance.now();
  try {
    const orOk = await checkOpenRouterFn();
    checks["openrouter_gateway"] = {
      status: orOk ? "ok" : "degraded",
      latencyMs: Math.round(performance.now() - t0),
      message: orOk
        ? "Gateway reachable"
        : "API key unset or gateway unreachable",
    };
    if (!orOk) overallHealthy = false;
  } catch (err: any) {
    checks["openrouter_gateway"] = {
      status: "failed",
      latencyMs: Math.round(performance.now() - t0),
      message: err.message,
    };
    overallHealthy = false;
  }

  // 3. Execution Engine Adapter Check
  const checkExecutorFn =
    options.checkExecutor ||
    (async () => {
      if (options.executor) {
        return options.executor.isAvailable();
      }
      return true;
    });

  const t1 = performance.now();
  try {
    const execOk = await checkExecutorFn();
    checks["execution_engine"] = {
      status: execOk ? "ok" : "failed",
      latencyMs: Math.round(performance.now() - t1),
      details: {
        type: options.executor?.name || "local_subprocess",
      },
    };
    if (!execOk) overallHealthy = false;
  } catch (err: any) {
    checks["execution_engine"] = {
      status: "failed",
      latencyMs: Math.round(performance.now() - t1),
      message: err.message,
    };
    overallHealthy = false;
  }

  // 4. Docker Daemon Connectivity Check
  const checkDockerFn =
    options.checkDocker ||
    (async () => {
      if (options.docker) {
        try {
          const ping = await options.docker.ping();
          return ping === "OK" || Buffer.isBuffer(ping);
        } catch {
          return false;
        }
      }
      const socketPath =
        process.platform === "win32"
          ? "//./pipe/docker_engine"
          : "/var/run/docker.sock";
      return existsSync(socketPath);
    });

  const tDocker = performance.now();
  try {
    const dockerOk = await checkDockerFn();
    checks["docker_daemon"] = {
      status: dockerOk ? "ok" : "degraded",
      latencyMs: Math.round(performance.now() - tDocker),
      message: dockerOk
        ? "Docker daemon socket reachable"
        : "Docker daemon socket not found or ping failed",
    };
  } catch (err: any) {
    checks["docker_daemon"] = {
      status: "degraded",
      latencyMs: Math.round(performance.now() - tDocker),
      message: err.message,
    };
  }

  // 5. Rust gRPC Executor Probe
  const checkGrpcFn =
    options.checkGrpc ||
    (async () => {
      const addr =
        options.grpcAddress ||
        process.env.CRUCIBLE_GRPC_ADDR ||
        "127.0.0.1:50051";
      const [host, portStr] = addr.split(":");
      const port = Number.parseInt(portStr || "50051", 10);
      return pingTcpPort(host || "127.0.0.1", port, 800);
    });

  const tGrpc = performance.now();
  try {
    const grpcOk = await checkGrpcFn();
    checks["rust_grpc_executor"] = {
      status: grpcOk ? "ok" : "degraded",
      latencyMs: Math.round(performance.now() - tGrpc),
      message: grpcOk
        ? "Rust gRPC executor reachable"
        : "Rust gRPC executor service unreachable",
    };
    const isGrpcActive = options.executor
      ? options.executor.name === "grpc"
      : process.env.CRUCIBLE_EXECUTOR === "grpc";
    if (!grpcOk && (isGrpcActive || options.grpcAddress)) {
      overallHealthy = false;
    }
  } catch (err: any) {
    checks["rust_grpc_executor"] = {
      status: "degraded",
      latencyMs: Math.round(performance.now() - tGrpc),
      message: err.message,
    };
  }

  // 6. Disk Workspace Check
  const checkDiskFn =
    options.checkDisk ||
    (async () => {
      const testFile = join(tmpdir(), `crucible_health_${Date.now()}.tmp`);
      await fs.writeFile(testFile, "ok", "utf8");
      await fs.unlink(testFile);
      return true;
    });

  const t2 = performance.now();
  try {
    const diskOk = await checkDiskFn();
    checks["disk_workspace"] = {
      status: diskOk ? "ok" : "failed",
      latencyMs: Math.round(performance.now() - t2),
    };
    if (!diskOk) overallHealthy = false;
  } catch (err: any) {
    checks["disk_workspace"] = {
      status: "failed",
      latencyMs: Math.round(performance.now() - t2),
      message: err.message,
    };
    overallHealthy = false;
  }

  // 7. Kubernetes Cluster API Check
  const isK8sActive = options.executor
    ? options.executor.name === "k8s_job"
    : process.env.CRUCIBLE_EXECUTOR === "k8s" ||
      process.env.CRUCIBLE_EXECUTOR === "kubernetes";

  if (options.checkKubernetes || isK8sActive) {
    const checkK8sFn =
      options.checkKubernetes ||
      (async () => {
        if (options.executor && options.executor.name === "k8s_job") {
          return options.executor.isAvailable();
        }
        const { KubernetesJobExecutor } =
          await import("../execution/k8s-job-executor");
        const k8sExec = new KubernetesJobExecutor();
        return k8sExec.isAvailable();
      });

    const tK8s = performance.now();
    try {
      const k8sOk = await checkK8sFn();
      checks["kubernetes_cluster"] = {
        status: k8sOk ? "ok" : "degraded",
        latencyMs: Math.round(performance.now() - tK8s),
        message: k8sOk
          ? "Kubernetes API cluster reachable"
          : "Kubernetes API unreachable",
      };
      if (!k8sOk && isK8sActive) {
        overallHealthy = false;
      }
    } catch (err: any) {
      checks["kubernetes_cluster"] = {
        status: "failed",
        latencyMs: Math.round(performance.now() - tK8s),
        message: err.message,
      };
      if (isK8sActive) {
        overallHealthy = false;
      }
    }
  }

  // 7. PostgreSQL Database Check
  if (
    options.checkPostgres ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  ) {
    const checkPgFn =
      options.checkPostgres ||
      (async () => {
        const { checkPostgresHealth } =
          await import("../persistence/postgres/client");
        return checkPostgresHealth();
      });

    try {
      const pgHealth = await checkPgFn();
      checks["postgres_database"] = {
        status: pgHealth.ok ? "ok" : "failed",
        latencyMs: pgHealth.latencyMs,
        message: pgHealth.ok ? "PostgreSQL connected" : pgHealth.error,
      };
      if (
        !pgHealth.ok &&
        (process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ) {
        overallHealthy = false;
      }
    } catch (err: any) {
      checks["postgres_database"] = {
        status: "failed",
        message: err.message,
      };
      overallHealthy = false;
    }
  }

  // 8. Redis Hot Cache Check
  if (options.checkRedis || process.env.REDIS_URL) {
    const checkRedisFn =
      options.checkRedis ||
      (async () => {
        const { RedisSessionStore } =
          await import("../persistence/redis/session-store");
        const store = new RedisSessionStore();
        const res = await store.checkHealth();
        await store.close();
        return res;
      });

    try {
      const redisHealth = await checkRedisFn();
      checks["redis_cache"] = {
        status: redisHealth.ok ? "ok" : "degraded",
        latencyMs: redisHealth.latencyMs,
        message: redisHealth.ok ? "Redis cache connected" : redisHealth.error,
      };
    } catch (err: any) {
      checks["redis_cache"] = {
        status: "degraded",
        message: err.message,
      };
    }
  }

  // 9. Guardrails & Policy Engine Check
  const tGuard = performance.now();
  try {
    const { getDefaultGuardrailChain } = await import("../guardrails");
    const chain = getDefaultGuardrailChain();
    const policies = chain.getPolicies();
    checks["guardrails_policy_engine"] = {
      status: policies.length > 0 ? "ok" : "degraded",
      latencyMs: Math.round(performance.now() - tGuard),
      message: `${policies.length} active policies loaded (${policies.map((p) => p.name).join(", ")})`,
    };
  } catch (err: any) {
    checks["guardrails_policy_engine"] = {
      status: "failed",
      latencyMs: Math.round(performance.now() - tGuard),
      message: err.message,
    };
  }

  const response: HealthCheckResponse = {
    status: overallHealthy ? "healthy" : "degraded",
    service: "crucible-orchestrator",
    version: "0.1.0",
    uptime: Math.round(process.uptime() * 100) / 100,
    timestamp: new Date().toISOString(),
    system: liveness.system,
    checks,
  };

  return {
    statusCode: overallHealthy ? 200 : 503,
    body: response,
  };
}

export async function handleHealthzRequest(): Promise<Response> {
  const liveness = performLivenessCheck();
  const addr = process.env.CRUCIBLE_GRPC_ADDR || "127.0.0.1:50051";
  const [host, portStr] = addr.split(":");
  const port = Number.parseInt(portStr || "50051", 10);
  const isGrpcOnline = await pingTcpPort(host || "127.0.0.1", port, 200);

  if (liveness.system) {
    liveness.system.grpcStatus = isGrpcOnline ? "online" : "down";
  }

  return new Response(JSON.stringify(liveness), {
    status: liveness.status === "healthy" ? 200 : 500,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function handleReadyzRequest(
  options: ReadinessCheckOptions = {},
): Promise<Response> {
  const readiness = await performReadinessCheck(options);
  return new Response(JSON.stringify(readiness.body), {
    status: readiness.statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
