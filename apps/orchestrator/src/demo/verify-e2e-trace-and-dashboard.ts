import { startHttpServer } from "../http/server";
import { MockModelProvider } from "../provider/mock";
import { ToolRegistry } from "../tools/registry";
import { createBashTool, calculatorTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { SessionManager } from "../session/session-manager";

async function verifyE2eTraceAndDashboard() {
  console.log("============================================================");
  console.log("🔍 E2E DISTRIBUTED TRACING & METRICS DASHBOARD VERIFICATION");
  console.log("============================================================\n");

  const executor = new LocalExecutor();
  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(createBashTool({ executor }));

  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
  });

  const server = startHttpServer({
    port: 4001,
    hostname: "127.0.0.1",
    sessionManager,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    console.log(`1️⃣ Connecting to Crucible Core API at ${baseUrl}...`);
    const healthRes = await fetch(`${baseUrl}/health`);
    if (!healthRes.ok) {
      throw new Error(`Health check failed with HTTP ${healthRes.status}`);
    }
    console.log("   ✓ Core API server is healthy and responding.\n");

    console.log(
      "2️⃣ Creating a new isolated agent session via POST /sessions...",
    );
    const createRes = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "E2E Tracing Test Session",
        systemPrompt: "You are a test assistant.",
      }),
    });

    const createJson = (await createRes.json()) as { id: string };
    const sessionId = createJson.id;
    console.log(`   ✓ Session created: ${sessionId}\n`);

    console.log(
      "3️⃣ Triggering an agent run across Orchestrator → Model → Tool → Executor Sandbox...",
    );
    const messageRes = await fetch(
      `${baseUrl}/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Calculate 42 * 10",
        }),
      },
    );

    const messageJson = (await messageRes.json()) as {
      sessionId: string;
      status: string;
      response: string;
    };
    console.log(`   ✓ Run finished with state: ${messageJson.status}`);
    console.log(`   ✓ Agent response: "${messageJson.response}"\n`);

    console.log(
      "4️⃣ Fetching continuous distributed trace from GET /api/traces...",
    );
    const traceRes = await fetch(
      `${baseUrl}/api/traces?sessionId=${sessionId}`,
    );
    const traceJson = (await traceRes.json()) as {
      status: string;
      count: number;
      data: Array<{
        id: string;
        traceId: string;
        parentSpanId?: string;
        name: string;
        status: string;
        durationMs: number;
        attributes: Record<string, unknown>;
      }>;
    };

    const spans = traceJson.data;
    console.log(
      `   ✓ Retrieved ${spans.length} trace spans for session ${sessionId}:`,
    );
    for (const span of spans) {
      console.log(
        `     ├─ [${span.name}] (id: ${span.id}, parent: ${span.parentSpanId || "ROOT"}) ` +
          `duration: ${span.durationMs}ms, status: ${span.status}, traceId: ${span.traceId}`,
      );
    }

    const uniqueTraceIds = new Set(spans.map((s) => s.traceId));
    if (uniqueTraceIds.size !== 1) {
      throw new Error(
        `Expected 1 continuous traceId across all layers, found: ${Array.from(uniqueTraceIds).join(", ")}`,
      );
    }
    const rootTraceId = spans[0].traceId;
    console.log(
      `\n   ✓ Continuous trace confirmed with single W3C Trace ID: ${rootTraceId}\n`,
    );

    console.log("5️⃣ Querying Metrics Dashboard data from GET /api/metrics...");
    const metricsRes = await fetch(
      `${baseUrl}/api/metrics?sessionId=${sessionId}`,
    );
    const metricsJson = (await metricsRes.json()) as {
      status: string;
      data: {
        timestamp: number;
        activeTraceCount: number;
        totalSpansRecorded: number;
        globalMeanLatencyMs: number;
        globalP95LatencyMs: number;
        globalToolCallsTotal: number;
        globalToolErrorRate: number;
        sessionMetrics: Record<
          string,
          {
            traceCount: number;
            activeTraceCount: number;
            meanLatencyMs: number;
            p50LatencyMs: number;
            p95LatencyMs: number;
            p99LatencyMs: number;
            toolCallsTotal: number;
            toolCallsFailed: number;
            toolErrorRate: number;
          }
        >;
      };
    };

    const metrics = metricsJson.data;
    console.log("   ✓ Metrics Dashboard snapshot received:");
    console.log(`     - Total Spans Recorded: ${metrics.totalSpansRecorded}`);
    console.log(`     - Active Traces In-Flight: ${metrics.activeTraceCount}`);
    console.log(`     - Global Mean Latency: ${metrics.globalMeanLatencyMs}ms`);
    console.log(`     - Global P95 Latency: ${metrics.globalP95LatencyMs}ms`);
    console.log(
      `     - Total Tool Invocations: ${metrics.globalToolCallsTotal}`,
    );
    console.log(`     - Tool Error Rate: ${metrics.globalToolErrorRate}%`);

    const sessionMetrics = metrics.sessionMetrics[sessionId];
    if (!sessionMetrics) {
      throw new Error(
        `Session ${sessionId} not found in sessionMetrics dictionary!`,
      );
    }

    console.log(`\n   ✓ Session Metrics for ${sessionId}:`);
    console.log(`     - Session Trace Count: ${sessionMetrics.traceCount}`);
    console.log(
      `     - Session Mean Latency: ${sessionMetrics.meanLatencyMs}ms`,
    );
    console.log(`     - Session P50 Latency: ${sessionMetrics.p50LatencyMs}ms`);
    console.log(`     - Session P95 Latency: ${sessionMetrics.p95LatencyMs}ms`);
    console.log(`     - Session P99 Latency: ${sessionMetrics.p99LatencyMs}ms`);
    console.log(
      `     - Active Traces (post-run): ${sessionMetrics.activeTraceCount}`,
    );

    if (sessionMetrics.meanLatencyMs <= 0) {
      throw new Error("Expected session mean latency to be positive");
    }

    if (sessionMetrics.activeTraceCount !== 0) {
      throw new Error(
        "Expected in-flight traces to return to 0 post-execution",
      );
    }

    console.log(
      "\n============================================================",
    );
    console.log("🎉 ALL CHECKS PASSED: END-TO-END TRACE & METRICS CONFIRMED!");
    console.log(
      "============================================================\n",
    );
  } finally {
    server.stop();
  }
}

verifyE2eTraceAndDashboard().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
