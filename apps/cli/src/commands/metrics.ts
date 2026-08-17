import { CrucibleClient } from "@crucible/sdk";
import { badge, c, formatTable, printBanner } from "../formatters";

export interface MetricsCommandOptions {
  endpoint?: string;
  tenantId?: string;
  namespace?: string;
  json?: boolean;
}

export async function runMetricsCommand(
  sessionId?: string,
  options: MetricsCommandOptions = {},
): Promise<number> {
  const client = new CrucibleClient({
    endpoint: options.endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  try {
    const metrics = await client.metrics.getSummary(sessionId);

    if (options.json) {
      console.log(JSON.stringify(metrics, null, 2));
      return 0;
    }

    printBanner(
      "CRUCIBLE METRICS DASHBOARD (PLAIN-TEXT DUMP)",
      sessionId
        ? `Scoped to Session: ${sessionId}`
        : "Platform-Wide Telemetry & Performance",
    );

    // 1. Token Usage Panel
    if (metrics.tokens) {
      console.log(`${c.bold}${c.cyan}■ TOKEN UTILIZATION PANEL${c.reset}`);
      const tokenRows = [
        [
          `Prompt Tokens`,
          (metrics.tokens.totalPromptTokens || 0).toLocaleString(),
        ],
        [
          `Completion Tokens`,
          (metrics.tokens.totalCompletionTokens || 0).toLocaleString(),
        ],
        [
          `${c.bold}Total Tokens${c.reset}`,
          `${c.bold}${(metrics.tokens.totalTokens || 0).toLocaleString()}${c.reset}`,
        ],
      ];
      console.log(formatTable(["Metric", "Count"], tokenRows));
      console.log();
    }

    // 2. Model Usage Panel
    if (metrics.models && Object.keys(metrics.models).length > 0) {
      console.log(
        `${c.bold}${c.yellow}■ MODEL USAGE & LATENCY PROFILES${c.reset}`,
      );
      const modelHeaders = [
        "Model Slug",
        "Requests",
        "Avg Latency",
        "Error Rate",
      ];
      const modelRows = Object.entries(metrics.models).map(
        ([modelKey, stats]) => [
          `${c.yellow}${modelKey}${c.reset}`,
          String(stats.requests || 0),
          `${Math.round(stats.avgLatencyMs || 0)}ms`,
          `${((stats.errorRate || 0) * 100).toFixed(1)}%`,
        ],
      );
      console.log(formatTable(modelHeaders, modelRows));
      console.log();
    }

    // 3. Role Activity Panel
    if (metrics.roles && Object.keys(metrics.roles).length > 0) {
      console.log(
        `${c.bold}${c.magenta}■ ROLE WORKLOAD & TOOL DISPATCH${c.reset}`,
      );
      const roleHeaders = [
        "Agent Role",
        "Turn Count",
        "Tool Invocations",
        "Error Rate",
      ];
      const roleRows = Object.entries(metrics.roles).map(([roleKey, stats]) => [
        `${c.magenta}${roleKey}${c.reset}`,
        String(stats.turns || 0),
        String(stats.toolCalls || 0),
        `${((stats.errorRate || 0) * 100).toFixed(1)}%`,
      ]);
      console.log(formatTable(roleHeaders, roleRows));
      console.log();
    }

    // 4. Queue & Tracing Panel
    console.log(
      `${c.bold}${c.green}■ QUEUE & INFRASTRUCTURE SUBSYSTEMS${c.reset}`,
    );
    const infraRows = [];
    if (metrics.queue) {
      infraRows.push([
        `Active Workers`,
        String(metrics.queue.activeConsumers || 0),
      ]);
      infraRows.push([
        `Max Concurrency`,
        String(metrics.queue.maxConcurrency || 0),
      ]);
      infraRows.push([
        `Queued Backlog`,
        String(metrics.queue.backlogCount || 0),
      ]);
      infraRows.push([
        `Dead-Letter Queue`,
        String(metrics.queue.deadLetterCount || 0),
      ]);
    }
    if (metrics.traces) {
      infraRows.push([
        `Active Traces`,
        String(metrics.traces.activeTraces || 0),
      ]);
      infraRows.push([`Total Spans`, String(metrics.traces.totalSpans || 0)]);
    }
    if (metrics.sessions) {
      infraRows.push([`Total Sessions`, String(metrics.sessions.total || 0)]);
      infraRows.push([`Active Sessions`, String(metrics.sessions.active || 0)]);
    }

    if (infraRows.length > 0) {
      console.log(formatTable(["Component Metric", "Value"], infraRows));
    }

    console.log(
      `\n  Timestamp: ${c.dim}${metrics.timestamp || new Date().toISOString()}${c.reset}\n`,
    );
    return 0;
  } catch (err: any) {
    console.error(
      `\n${badge("ERROR", "fail")} Failed to fetch telemetry metrics: ${err.message}\n`,
    );
    return 1;
  }
}
