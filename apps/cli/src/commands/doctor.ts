import { CrucibleClient, type DoctorDiagnosticResult } from "@crucible/sdk";
import { badge, c, formatTable, printBanner } from "../formatters";

export interface DoctorCommandOptions {
  endpoint?: string;
  timeout?: number;
  json?: boolean;
  verbose?: boolean;
}

export async function runDoctorCommand(
  options: DoctorCommandOptions = {},
): Promise<number> {
  const endpoint =
    options.endpoint ||
    process.env.CRUCIBLE_ENDPOINT ||
    (process.env.PORT
      ? `http://localhost:${process.env.PORT}`
      : "http://localhost:4000");

  const client = new CrucibleClient({
    endpoint,
    timeoutMs: options.timeout || 6000,
  });

  if (!options.json) {
    printBanner(
      "Crucible Deployment Doctor",
      `Probing diagnostics against ${endpoint}`,
    );
  }

  let result: DoctorDiagnosticResult;
  try {
    result = await client.runDoctor({ timeoutMs: options.timeout || 6000 });
  } catch (err: any) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { status: "error", error: err.message || String(err) },
          null,
          2,
        ),
      );
      return 1;
    }

    console.error(
      `${c.red}${c.bold}Failed to execute diagnostic probe:${c.reset} ${err.message || err}\n`,
    );
    console.error(`${c.yellow}Troubleshooting tips:${c.reset}`);
    console.error(
      `  1. Is the orchestrator server running? Start it via ${c.bold}make serve${c.reset} or ${c.bold}make start${c.reset}`,
    );
    console.error(
      `  2. Is the endpoint correct? Current: ${c.bold}${endpoint}${c.reset} (override via ${c.bold}--endpoint <url>${c.reset})`,
    );
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.overallHealthy ? 0 : 1;
  }

  const tableHeaders = ["Subsystem / Check", "Status", "Latency", "Details"];
  const tableRows: string[][] = [];

  for (const [key, check] of Object.entries(result.checks)) {
    const formattedName = formatCheckName(key);
    const statusBadge =
      check.status === "ok"
        ? badge("OK", "ok")
        : check.status === "degraded"
          ? badge("DEGRADED", "warn")
          : badge("FAILED", "fail");

    const latency =
      check.latencyMs !== undefined ? `${check.latencyMs}ms` : "-";
    const detailMsg =
      check.message || (check.status === "ok" ? "Nominal" : "Check failed");

    tableRows.push([formattedName, statusBadge, latency, detailMsg]);
  }

  console.log(formatTable(tableHeaders, tableRows));
  console.log("");

  if (result.system) {
    console.log(`${c.bold}System Telemetry:${c.reset}`);
    console.log(`  • Runtime:   ${result.system.runtime || "bun"}`);
    console.log(
      `  • Process:   PID ${result.system.pid} (Uptime: ${Math.round(result.uptimeSeconds)}s)`,
    );
    console.log(
      `  • Memory:    RSS ${result.system.memoryMb.rss} MB | Heap ${result.system.memoryMb.heapUsed}/${result.system.memoryMb.heapTotal} MB`,
    );
    if (result.system.dockerSocketPresent !== undefined) {
      console.log(
        `  • Docker:    ${result.system.dockerSocketPresent ? `${c.green}Socket connected${c.reset}` : `${c.yellow}Socket missing${c.reset}`}`,
      );
    }
    if (result.system.grpcStatus) {
      console.log(
        `  • Rust gRPC: ${result.system.grpcStatus === "online" ? `${c.green}Online (port 50051)${c.reset}` : `${c.yellow}Offline / not reachable${c.reset}`}`,
      );
    }
    console.log("");
  }

  if (result.overallHealthy) {
    console.log(
      `${c.green}${c.bold}✔ ALL SYSTEMS OPERATIONAL${c.reset} — Target deployment is healthy.\n`,
    );
    return 0;
  }

  if (result.status === "degraded") {
    console.log(
      `${c.yellow}${c.bold}⚠ SYSTEM DEGRADED${c.reset} — Core is operational with fallback modes or missing non-critical services.\n`,
    );
  } else {
    console.log(
      `${c.red}${c.bold}✖ SYSTEM UNHEALTHY${c.reset} — One or more critical dependencies failed.\n`,
    );
  }

  if (result.remediationTips.length > 0) {
    console.log(`${c.bold}${c.yellow}Recommended Remediation Steps:${c.reset}`);
    result.remediationTips.forEach((tip, idx) => {
      console.log(`  ${idx + 1}. ${tip}`);
    });
    console.log("");
  }

  return result.overallHealthy ? 0 : 1;
}

function formatCheckName(key: string): string {
  const map: Record<string, string> = {
    liveness_probe: "Orchestrator Liveness",
    orchestrator_loop: "Agent FSM Loop",
    openrouter_gateway: "OpenRouter Gateway",
    execution_engine: "Execution Backend Adapter",
    docker_daemon: "Docker Daemon Engine",
    rust_grpc_executor: "Rust gRPC Executor Core",
    disk_workspace: "Ephemeral Workspace Disk",
    kubernetes_cluster: "Kubernetes Cluster API",
    postgres_database: "PostgreSQL Database",
    redis_cache: "Redis Hot Session Cache",
    guardrails_policy_engine: "Guardrails & Policy Engine",
    job_queue: "Job Queue & Load Leveling",
  };

  return (
    map[key] || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  );
}
