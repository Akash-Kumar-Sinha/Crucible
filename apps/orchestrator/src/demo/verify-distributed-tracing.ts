import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import { ToolRegistry } from "../tools/registry";
import { calculatorTool, createBashTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { spanCollector } from "../observability/otel";
import { getErrorReporter } from "../observability/error-reporter";

async function runDistributedTracingVerification() {
  const registry = new ToolRegistry();
  const executor = new LocalExecutor();
  registry.register(calculatorTool);
  registry.register(createBashTool({ executor }));

  const sessionManager = new SessionManager({
    defaultTools: registry,
  });

  const errorReporter = getErrorReporter();
  errorReporter.attachToSessionManager(sessionManager);

  const provider1 = new MockModelProvider();
  const session1 = sessionManager.createSession({
    provider: provider1,
    title: "Session 1 - Math",
  });

  const provider2 = new MockModelProvider();
  const session2 = sessionManager.createSession({
    provider: provider2,
    title: "Session 2 - Shell",
  });

  const [res1, res2] = await Promise.all([
    session1.prompt("Calculate 42 * 10"),
    session2.prompt("Check system kernel"),
  ]);

  const allSpans = spanCollector.getSpans({ limit: 50 });
  const s1Spans = spanCollector.getSpans({ sessionId: session1.id });
  const s2Spans = spanCollector.getSpans({ sessionId: session2.id });
  const summary = spanCollector.getSystemSummary();

  console.log("Total spans recorded:", allSpans.length);
  console.log("Session 1 spans:", s1Spans.length);
  console.log("Session 2 spans:", s2Spans.length);
  console.log("System summary active traces:", summary.activeTraceCount);
}

runDistributedTracingVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
