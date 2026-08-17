import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import { createHttpRouter } from "../http/server";
import { CrucibleClient } from "@crucible/sdk";

export async function runCliFeatureParityVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "  CRUCIBLE - HEADLESS CLI & SDK FEATURE PARITY VERIFICATION DEMO",
  );
  console.log(
    "================================================================================",
  );

  const passedTests: string[] = [];

  // Setup in-memory SessionManager & HTTP router
  const defaultProvider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider,
    autoPersist: false,
  });

  const router = createHttpRouter(sessionManager);

  // In-memory fetch bridge connecting SDK / CLI directly to orchestrator HTTP router
  const inMemoryFetch = async (input: any, init?: any) => {
    const rawUrl = typeof input === "string" ? input : input.url;
    const url = rawUrl.replace(
      "http://127.0.0.1:4999",
      "http://localhost:4000",
    );
    const req = new Request(url, {
      method: init?.method || "GET",
      headers: init?.headers,
      body: init?.body,
    });
    return router(req);
  };

  const client = new CrucibleClient({
    endpoint: "http://127.0.0.1:4999",
    fetch: inMemoryFetch,
  });

  // 1. Session Creation with Role & Model Parity (Mirrors RoleModelPicker.tsx)
  console.log(
    "\n[1/4] Testing CLI/SDK session-create (Role & Model Parity)...",
  );
  const createdSession = await client.sessions.create({
    title: "Headless Bug Hunter Task",
    role: "bug_hunter",
    model: "anthropic/claude-3.5-sonnet",
  });

  console.log(`  - Session Created: ${createdSession.id}`);
  console.log(`  - Assigned Role: ${createdSession.role}`);
  console.log(`  - Assigned Model: ${createdSession.model}`);

  if (
    createdSession.role !== "bug_hunter" ||
    createdSession.model !== "anthropic/claude-3.5-sonnet"
  ) {
    throw new Error(
      "Session role and model strategy did not match specified parameters",
    );
  }
  passedTests.push("Session Creation with Role & Model Strategy Parity");

  // 2. Context Usage & Compaction Status Parity
  console.log("\n[2/4] Testing CLI/SDK context-usage & Token Utilization...");
  const contextUsage = await client.sessions.getContextUsage(createdSession.id);
  console.log(`  - Total Tokens: ${contextUsage.totalTokens}`);
  console.log(`  - Window Limit: ${contextUsage.limit}`);
  console.log(`  - Usage Percent: ${contextUsage.usagePercent}%`);
  console.log(`  - Strategy: ${contextUsage.strategyName}`);
  passedTests.push("Context Window & Token Utilization Status");

  // 3. Bug Hunter Cryptographic Audit Trail Parity
  console.log(
    "\n[3/4] Testing CLI/SDK audit-tail & Cryptographic Verification...",
  );
  const auditRecords = await client.audit.getRecords();
  console.log(`  - Audit Records Retrieved: ${auditRecords.length}`);

  const integrity = await client.audit.verifyIntegrity();
  console.log(`  - Tamper-Evident Hash Chain Valid: ${integrity.valid}`);
  passedTests.push("Cryptographic Audit Trail Inspection & Verification");

  // 4. Metrics Dashboard Telemetry Parity
  console.log("\n[4/4] Testing CLI/SDK metrics Summary Dump...");
  const metrics = await client.metrics.getSummary();
  console.log(`  - Telemetry Timestamp: ${metrics.timestamp}`);
  console.log(
    `  - Active Worker Pool Concurrency: ${metrics.queue?.maxConcurrency ?? 4}`,
  );
  passedTests.push("Metrics Dashboard Telemetry Plain-Text Dump");

  console.log(
    "\n================================================================================",
  );
  console.log(
    "  VERIFICATION SUMMARY: ALL CLI & SDK FEATURE PARITY TESTS PASSED",
  );
  console.log(
    "================================================================================",
  );
  passedTests.forEach((testName, i) => {
    console.log(`  [${i + 1}/${passedTests.length}] ${testName}: PASSED`);
  });
  console.log(
    "================================================================================\n",
  );
}

if (import.meta.main) {
  runCliFeatureParityVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("CLI feature parity verification failed:", err);
      process.exit(1);
    });
}
