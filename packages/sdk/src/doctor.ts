import type {
  DependencyCheck,
  DoctorDiagnosticResult,
  HealthCheckStatus,
} from "./types";

export interface DoctorCheckOptions {
  endpoint?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch | ((input: any, init?: any) => Promise<Response>);
}

export class DoctorClient {
  constructor(
    private readonly defaultEndpoint: string,
    private readonly defaultHeaders: Record<string, string> = {},
    private readonly fetchFn:
      | typeof fetch
      | ((input: any, init?: any) => Promise<Response>) = globalThis.fetch,
  ) {}

  private normalizeUrl(endpoint: string, path: string): string {
    const base = endpoint.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  async checkLiveness(
    options: DoctorCheckOptions = {},
  ): Promise<{ status: HealthCheckStatus; body: any; latencyMs: number }> {
    const endpoint = options.endpoint || this.defaultEndpoint;
    const url = this.normalizeUrl(endpoint, "/healthz");
    const t0 = performance.now();

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 3000,
    );

    try {
      const res = await (options.fetch || this.fetchFn)(url, {
        method: "GET",
        headers: { ...this.defaultHeaders, ...options.headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - t0);
      const body = await res.json();
      return {
        status: res.ok ? "healthy" : "unhealthy",
        body,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - t0);
      return {
        status: "unhealthy",
        body: { error: err.message || "Failed to reach /healthz" },
        latencyMs,
      };
    }
  }

  async checkReadiness(
    options: DoctorCheckOptions = {},
  ): Promise<{ status: HealthCheckStatus; body: any; latencyMs: number }> {
    const endpoint = options.endpoint || this.defaultEndpoint;
    const url = this.normalizeUrl(endpoint, "/readyz");
    const t0 = performance.now();

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 5000,
    );

    try {
      const res = await (options.fetch || this.fetchFn)(url, {
        method: "GET",
        headers: { ...this.defaultHeaders, ...options.headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - t0);
      const body = await res.json();
      return {
        status: res.ok
          ? "healthy"
          : res.status === 503
            ? "degraded"
            : "unhealthy",
        body,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - t0);
      return {
        status: "unhealthy",
        body: { error: err.message || "Failed to reach /readyz" },
        latencyMs,
      };
    }
  }

  async runDiagnostics(
    options: DoctorCheckOptions = {},
  ): Promise<DoctorDiagnosticResult> {
    const endpoint = options.endpoint || this.defaultEndpoint;
    const timeoutMs = options.timeoutMs || 6000;

    const [liveRes, readyRes] = await Promise.all([
      this.checkLiveness({ endpoint, timeoutMs, ...options }),
      this.checkReadiness({ endpoint, timeoutMs, ...options }),
    ]);

    const checks: Record<string, DependencyCheck> = {};
    const remediationTips: string[] = [];

    const isLiveOk = liveRes.status === "healthy";
    checks["liveness_probe"] = {
      status: isLiveOk ? "ok" : "failed",
      latencyMs: liveRes.latencyMs,
      message: isLiveOk
        ? "Orchestrator HTTP server online"
        : liveRes.body?.error || "Liveness check failed",
    };

    if (!isLiveOk) {
      remediationTips.push(
        "Ensure the Crucible orchestrator is running (`make serve` or `make start`). Verify port 4000 is open.",
      );
    }

    if (readyRes.body?.checks && typeof readyRes.body.checks === "object") {
      for (const [key, val] of Object.entries(
        readyRes.body.checks as Record<string, DependencyCheck>,
      )) {
        checks[key] = val;

        if (val.status === "failed" || val.status === "degraded") {
          remediationTips.push(this.generateRemediationTip(key, val));
        }
      }
    } else if (readyRes.status !== "healthy") {
      checks["readiness_probe"] = {
        status: "failed",
        latencyMs: readyRes.latencyMs,
        message: readyRes.body?.error || "Readiness endpoint returned error",
      };
      remediationTips.push(
        "Check orchestrator stderr logs for unhandled initialization errors.",
      );
    }

    const hasFailed = Object.values(checks).some((c) => c.status === "failed");
    const hasDegraded = Object.values(checks).some(
      (c) => c.status === "degraded",
    );

    const overallStatus: HealthCheckStatus = hasFailed
      ? "unhealthy"
      : hasDegraded
        ? "degraded"
        : isLiveOk
          ? "healthy"
          : "unhealthy";

    return {
      status: overallStatus,
      endpoint,
      version: readyRes.body?.version || liveRes.body?.version || "0.1.0",
      uptimeSeconds: readyRes.body?.uptime || liveRes.body?.uptime || 0,
      timestamp: readyRes.body?.timestamp || new Date().toISOString(),
      system: liveRes.body?.system || readyRes.body?.system,
      checks,
      remediationTips,
      overallHealthy: overallStatus === "healthy",
    };
  }

  private generateRemediationTip(key: string, check: DependencyCheck): string {
    switch (key) {
      case "openrouter_gateway":
        return "OpenRouter API Key: Set `OPENROUTER_API_KEY` in .env or run with `OPENROUTER_MODEL=mock` for offline development.";
      case "rust_grpc_executor":
        return "Rust gRPC Executor: Ensure `crates/executor-grpc` is running on port 50051 or start the full stack with `make docker-up`.";
      case "docker_daemon":
        return "Docker Socket: Start Docker Desktop / Docker daemon or set `CRUCIBLE_EXECUTOR=local` for subprocess execution.";
      case "kubernetes_cluster":
        return "Kubernetes Cluster: Check kubectl context (`kubectl cluster-info`) or verify kind cluster with `make k8s-cluster`.";
      case "postgres_database":
        return "PostgreSQL: Verify PostgreSQL connection string in `DATABASE_URL` or launch database via `docker compose up -d postgres`.";
      case "redis_cache":
        return "Redis Cache: Verify Redis connection in `REDIS_URL` or launch redis via `docker compose up -d redis`.";
      case "job_queue":
        return "Job Queue: Check dead-letter queue via `/api/queue/jobs?status=dead_letter` or restart workers.";
      case "livekit_server":
        return "LiveKit SFU Server: Start the self-hosted LiveKit container on port 7880 (`docker compose up -d livekit`) or verify `LIVEKIT_URL`.";
      case "guardrails_policy_engine":
        return "Guardrails Policy Engine: Check policy evaluator configuration and ensure resource budget limits are valid.";
      case "circuit_breakers":
        return "Circuit Breakers: One or more circuit breakers are open (tripped). Check underlying provider/executor errors.";
      default:
        return `${key}: ${check.message || "Component degraded"}. Check orchestrator logs for details.`;
    }
  }
}
