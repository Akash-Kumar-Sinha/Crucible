import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import { createHttpRouter } from "../http/server";
import { CrucibleClient } from "@crucible/sdk";
import { getCircuitBreakerRegistry } from "../resilience/circuit-breaker";
import { getErrorReporter } from "../observability/error-reporter";

export async function runSettingsKeyAndResilienceBannerVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "  CRUCIBLE - SETTINGS API KEY GENERATION, SDK/CLI & RESILIENCE BANNER DEMO",
  );
  console.log(
    "================================================================================",
  );

  const passedTests: string[] = [];
  const _reporter = getErrorReporter();

  // Setup local orchestrator router and session manager
  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    autoPersist: false,
  });
  const router = createHttpRouter(sessionManager);

  // Custom fetch function routing SDK requests directly to in-memory router
  const inMemoryFetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    const req = new Request(url, init);
    return router(req);
  };

  // ---------------------------------------------------------------------------
  // 1. SETTINGS PAGE API KEY / SDK SESSION TOKEN GENERATION & SDK CLIENT
  // ---------------------------------------------------------------------------
  console.log(
    "\n[1/3] Generating Developer SDK Token & Configuring CrucibleClient...",
  );

  // Simulate Settings Page Token Generation Logic (apps/web/src/app/settings/page.tsx)
  const generatedToken = `crucible_sk_${Math.random().toString(36).substring(2, 12)}_${Date.now().toString(36)}`;
  console.log(
    `  - Generated Settings SDK Token: ${generatedToken.slice(0, 24)}...`,
  );

  // Initialize SDK Client with generated key
  const client = new CrucibleClient({
    endpoint: "http://127.0.0.1:4000",
    apiKey: generatedToken,
    authToken: generatedToken,
    tenantId: "engineering-core",
    namespace: "crucible-prod",
    fetch: inMemoryFetch as any,
  });

  // Run Doctor Self-Diagnostics via SDK
  console.log("  - Running Crucible Doctor diagnostic suite via SDK...");
  const diag = await client.doctor.runDiagnostics();
  console.log(`  - Doctor Health Status: ${diag.status.toUpperCase()}`);
  console.log(
    `  - Diagnostics Checks Count: ${Object.keys(diag.checks).length}`,
  );

  // Discover registered tools via SDK
  console.log("  - Discovering tools via SDK...");
  const tools = await client.tools.list();
  console.log(`  - Registered Tools Count: ${tools.length}`);

  // Create session and execute prompt via SDK
  console.log("  - Creating session and sending prompt via SDK...");
  const session = await client.sessions.create({
    title: "SDK Verified Session",
    role: "general",
  });
  console.log(
    `  - Session Created via SDK: ${session.id} (Role: ${session.role})`,
  );

  const promptResult = await client.sessions.prompt(
    session.id,
    "Execute system status check",
  );
  const responseText = promptResult.response || "";
  console.log(`  - SDK Prompt Result: "${responseText.slice(0, 48)}..."`);
  console.log(`  - Turn Count: ${promptResult.turns ?? 1}`);

  if (!promptResult.response) {
    throw new Error("SDK prompt execution failed with generated token");
  }
  passedTests.push("Settings API Key & Developer SDK Execution");

  // ---------------------------------------------------------------------------
  // 2. DELIBERATELY TRIPPING CIRCUIT BREAKER (RESILIENCE HARDENING)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[2/3] Deliberately Tripping Circuit Breaker & Monitoring Telemetry...",
  );

  const cbRegistry = getCircuitBreakerRegistry();
  const targetBreaker = cbRegistry.get("openrouter_llm");
  if (!targetBreaker) {
    throw new Error("Target circuit breaker 'openrouter_llm' not found");
  }

  // Verify initial state is closed
  console.log(
    `  - Initial 'openrouter_llm' State: ${targetBreaker.getState().toUpperCase()}`,
  );
  if (targetBreaker.getState() !== "closed") {
    targetBreaker.reset();
  }

  // Check /resilience/status before trip
  const beforeRes = await router(
    new Request("http://127.0.0.1:4000/resilience/status"),
  );
  const beforeData = (await beforeRes.json()) as any;
  console.log(
    `  - Cluster Status Before Trip: ${beforeData.status.toUpperCase()} (hasOpenBreakers: ${beforeData.hasOpenBreakers})`,
  );

  // Deliberately trip the breaker via REST route
  console.log(
    "  - Dispatched POST /resilience/breakers/openrouter_llm/trip...",
  );
  const tripRes = await router(
    new Request(
      "http://127.0.0.1:4000/resilience/breakers/openrouter_llm/trip",
      {
        method: "POST",
        body: JSON.stringify({
          reason: "Simulated chaos drill from Settings UI",
        }),
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
  const tripData = (await tripRes.json()) as any;
  console.log(`  - Trip Response: ${tripData.message}`);

  if (targetBreaker.getState() !== "open") {
    throw new Error("Circuit breaker failed to trip to OPEN");
  }
  passedTests.push("Circuit Breaker Deliberate Trip Action");

  // ---------------------------------------------------------------------------
  // 3. REAL-TIME STATUS BANNER PRESENTATION & RESET ACTION
  // ---------------------------------------------------------------------------
  console.log(
    "\n[3/3] Verifying Real-Time Resilience Banner Presentation & UI Reset Action...",
  );

  // Query /resilience/status while tripped
  const statusRes = await router(
    new Request("http://127.0.0.1:4000/resilience/status"),
  );
  const statusData = (await statusRes.json()) as any;

  console.log(
    `  - GET /resilience/status Status: ${statusData.status.toUpperCase()}`,
  );
  console.log(`  - Has Open Breakers: ${statusData.hasOpenBreakers}`);
  const openBreakerMetrics = statusData.breakers.find(
    (b: any) => b.name === "openrouter_llm",
  );
  console.log(
    `  - Breaker Telemetry: ${openBreakerMetrics.name} is ${openBreakerMetrics.state.toUpperCase()}`,
  );

  if (
    statusData.status !== "degraded" ||
    !statusData.hasOpenBreakers ||
    openBreakerMetrics.state !== "open"
  ) {
    throw new Error(
      "Telemetry did not reflect degraded cluster state with open breaker",
    );
  }

  // Simulate UI ResilienceStatusBanner behavior:
  // Instead of a mysterious opaque network failure, the Decorator banner renders:
  // 1. Badge: "CIRCUIT BREAKER TRIPPED"
  // 2. Alert message: "openrouter_llm - Upstream provider failing fast. Auto-recovery active."
  // 3. Direct action button: "Reset Breaker"
  console.log(
    "  - [UI Simulation] ResilienceStatusBanner Decorator catches open breaker:",
  );
  console.log(`    * [ALERT BADGE]: CIRCUIT BREAKER TRIPPED`);
  console.log(
    `    * [CONTEXT]: ${openBreakerMetrics.name} is failing fast. Auto-recovery in progress.`,
  );
  console.log(`    * [ACTION]: Reset Breaker button rendered in top banner.`);

  // Simulate user clicking "Reset Breaker" from banner or Settings page
  console.log(
    "  - [User Action] User clicks 'Reset Breaker' (POST /resilience/breakers/openrouter_llm/reset)...",
  );
  const resetRes = await router(
    new Request(
      "http://127.0.0.1:4000/resilience/breakers/openrouter_llm/reset",
      {
        method: "POST",
      },
    ),
  );
  const resetData = (await resetRes.json()) as any;
  console.log(`  - Reset Response: ${resetData.message}`);

  // Query /resilience/status after reset
  const afterRes = await router(
    new Request("http://127.0.0.1:4000/resilience/status"),
  );
  const afterData = (await afterRes.json()) as any;
  console.log(
    `  - GET /resilience/status after Reset: ${afterData.status.toUpperCase()} (hasOpenBreakers: ${afterData.hasOpenBreakers})`,
  );

  if (
    afterData.status !== "ok" ||
    afterData.hasOpenBreakers ||
    targetBreaker.getState() !== "closed"
  ) {
    throw new Error("Circuit breaker did not reset back to CLOSED");
  }
  passedTests.push("Real-Time Resilience Banner & UI Reset Action");

  // Clean up session manager
  sessionManager.clear();

  console.log(
    "\n================================================================================",
  );
  console.log(
    "  VERIFICATION SUMMARY: ALL SETTINGS, SDK & BANNER TESTS PASSED",
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
  runSettingsKeyAndResilienceBannerVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Verification failed:", err);
      process.exit(1);
    });
}
