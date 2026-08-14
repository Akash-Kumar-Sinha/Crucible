import { promises as fs, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  };
  checks?: Record<string, DependencyCheck>;
}

export interface ReadinessCheckOptions {
  provider?: OpenRouterProvider;
  executor?: Executor;
  docker?: Docker;
  checkOpenRouter?: () => Promise<boolean>;
  checkExecutor?: () => Promise<boolean>;
  checkDocker?: () => Promise<boolean>;
  checkDisk?: () => Promise<boolean>;
  timeoutMs?: number;
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

  // 5. Disk Workspace Check
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

export function handleHealthzRequest(): Response {
  const liveness = performLivenessCheck();
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
