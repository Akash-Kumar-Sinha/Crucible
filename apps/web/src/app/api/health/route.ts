import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface WebHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    web_runtime: {
      status: "ok" | "failed";
      environment: string;
    };
    orchestrator_backend?: {
      status: "ok" | "degraded" | "failed";
      latencyMs?: number;
      endpoint?: string;
      message?: string;
    };
  };
}

export async function GET(): Promise<NextResponse<WebHealthResponse>> {
  const orchestratorUrl =
    process.env.ORCHESTRATOR_URL || "http://localhost:4000";

  type OrchestratorStatus = "ok" | "degraded" | "failed";

  let orchestratorStatus: OrchestratorStatus;

  let latencyMs: number | undefined;
  let message: string | undefined;

  const t0 = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${orchestratorUrl}/healthz`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timer);
    latencyMs = Math.round(performance.now() - t0);

    if (res.ok) {
      orchestratorStatus = "ok";
      message = "Connected to orchestrator process";
    } else {
      orchestratorStatus = "degraded";
      message = `Orchestrator returned HTTP ${res.status}`;
    }
  } catch (err: any) {
    latencyMs = Math.round(performance.now() - t0);
    orchestratorStatus = "failed";
    message = err.message || "Failed to reach orchestrator backend";
  }

  const overallHealthy = orchestratorStatus === "ok";

  const payload: WebHealthResponse = {
    status: overallHealthy ? "healthy" : "degraded",
    service: "crucible-web",
    version: "0.1.0",
    uptime: Math.round(process.uptime() * 100) / 100,
    timestamp: new Date().toISOString(),
    checks: {
      web_runtime: {
        status: "ok",
        environment: process.env.NODE_ENV || "development",
      },
      orchestrator_backend: {
        status: orchestratorStatus,
        latencyMs,
        endpoint: `${orchestratorUrl}/healthz`,
        message,
      },
    },
  };

  return NextResponse.json(payload, {
    status: overallHealthy ? 200 : 503,
  });
}
