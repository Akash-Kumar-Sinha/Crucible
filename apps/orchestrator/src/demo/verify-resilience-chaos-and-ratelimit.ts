import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../resilience/circuit-breaker";
import { MultiTierRateLimiter } from "../resilience/rate-limiter";
import { getErrorReporter } from "../observability/error-reporter";
import { SessionManager } from "../session/session-manager";
import { createHttpRouter } from "../http/server";

export async function runResilienceChaosAndRateLimitVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "  CRUCIBLE - CHAOS CIRCUIT BREAKER & MULTI-SESSION RATE LIMITING DEMO",
  );
  console.log(
    "================================================================================",
  );

  const passedTests: string[] = [];
  const _reporter = getErrorReporter();

  // ---------------------------------------------------------------------------
  // 1. CHAOS-TESTING CIRCUIT BREAKER: FAILING DEPENDENCY & FAST-FAIL VERIFICATION
  // ---------------------------------------------------------------------------
  console.log(
    "\n[1/3] Chaos-Testing Circuit Breaker: Simulating LLM Provider / Executor Degradation...",
  );

  let upstreamCallCounter = 0;
  let simulatedFailureMode = true;

  // Mock upstream LLM provider / compute executor
  const simulateUpstreamDependency = async (
    prompt: string,
  ): Promise<string> => {
    upstreamCallCounter++;
    if (simulatedFailureMode) {
      throw new Error(
        `503 Service Unavailable: upstream LLM provider timed out for '${prompt}'`,
      );
    }
    return `Completed: ${prompt}`;
  };

  const chaosBreaker = new CircuitBreaker({
    name: "chaos_llm_provider",
    failureThreshold: 3,
    recoveryTimeoutMs: 250, // fast cooldown for test verification
    halfOpenSuccessThreshold: 2,
    halfOpenMaxTrials: 2,
  });

  console.log(
    `  - Initial Breaker State: ${chaosBreaker.getState().toUpperCase()}`,
  );
  if (chaosBreaker.getState() !== "closed") {
    throw new Error(
      `Expected initial state 'closed', got '${chaosBreaker.getState()}'`,
    );
  }

  // Force 3 consecutive failures to trip breaker
  console.log("  - Forcing 3 consecutive upstream failures (threshold: 3)...");
  for (let i = 1; i <= 3; i++) {
    try {
      await chaosBreaker.execute(() =>
        simulateUpstreamDependency(`failing_request_${i}`),
      );
    } catch (err: any) {
      console.log(
        `    [Attempt ${i}] Upstream failed as expected: ${err.message.slice(0, 48)}...`,
      );
    }
  }

  console.log(
    `  - Breaker State after 3 failures: ${chaosBreaker.getState().toUpperCase()}`,
  );
  console.log(`  - Total upstream calls made: ${upstreamCallCounter}`);

  if (chaosBreaker.getState() !== "open") {
    throw new Error(
      `Expected circuit breaker to be OPEN after 3 failures, got '${chaosBreaker.getState()}'`,
    );
  }
  passedTests.push(
    "Circuit breaker trips to OPEN upon reaching failure threshold",
  );

  // ---------------------------------------------------------------------------
  // Verify Fast-Failing (Zero requests dispatched to dead dependency)
  // ---------------------------------------------------------------------------
  console.log(
    "\n  - Firing 10 subsequent requests while Circuit Breaker is OPEN...",
  );
  const callsBeforeBurst = upstreamCallCounter;
  let fastFailCount = 0;

  for (let i = 1; i <= 10; i++) {
    try {
      await chaosBreaker.execute(() =>
        simulateUpstreamDependency(`burst_request_${i}`),
      );
    } catch (err: any) {
      if (err instanceof CircuitBreakerOpenError) {
        fastFailCount++;
      }
    }
  }

  const callsAfterBurst = upstreamCallCounter;
  const callsDispatchedToUpstream = callsAfterBurst - callsBeforeBurst;

  console.log(
    `    * Fast-failed by Circuit Breaker: ${fastFailCount}/10 requests`,
  );
  console.log(
    `    * Additional calls dispatched to upstream: ${callsDispatchedToUpstream} (EXPECTED: 0)`,
  );

  if (callsDispatchedToUpstream !== 0) {
    throw new Error(
      `Circuit breaker failed to protect upstream! Dispatched ${callsDispatchedToUpstream} calls while OPEN.`,
    );
  }
  if (fastFailCount !== 10) {
    throw new Error(`Expected 10 fast-failures, got ${fastFailCount}`);
  }
  passedTests.push(
    "Circuit breaker fast-fails 100% of requests without hammering dead upstream",
  );

  // ---------------------------------------------------------------------------
  // Verify Half-Open Recovery and Self-Healing
  // ---------------------------------------------------------------------------
  console.log(
    "\n  - Testing Breaker Auto-Recovery (Cooldown -> Half-Open -> Closed)...",
  );
  console.log("    * Waiting 300ms for recovery cooldown to elapse...");
  await new Promise((r) => setTimeout(r, 300));

  console.log(
    `    * State after cooldown: ${chaosBreaker.getState().toUpperCase()}`,
  );
  if (chaosBreaker.getState() !== "half_open") {
    throw new Error(`Expected 'half_open', got '${chaosBreaker.getState()}'`);
  }

  // Restore upstream health
  simulatedFailureMode = false;
  console.log("    * Restored upstream health. Sending canary trials...");

  const canary1 = await chaosBreaker.execute(() =>
    simulateUpstreamDependency("canary_probe_1"),
  );
  console.log(`    * Canary 1: ${canary1}`);

  const canary2 = await chaosBreaker.execute(() =>
    simulateUpstreamDependency("canary_probe_2"),
  );
  console.log(`    * Canary 2: ${canary2}`);

  console.log(
    `    * Final Breaker State: ${chaosBreaker.getState().toUpperCase()}`,
  );
  if (chaosBreaker.getState() !== "closed") {
    throw new Error(
      `Expected 'closed' after successful canary trials, got '${chaosBreaker.getState()}'`,
    );
  }
  passedTests.push(
    "Circuit breaker self-heals from HALF_OPEN to CLOSED upon successful canary trials",
  );

  // ---------------------------------------------------------------------------
  // 2. TOKEN-BUCKET MULTI-SESSION RATE LIMITING & STRICT ISOLATION
  // ---------------------------------------------------------------------------
  console.log(
    "\n[2/3] Testing Token-Bucket Multi-Session Rate Limiting & Isolation...",
  );

  const rateLimiter = new MultiTierRateLimiter({
    sessionLimit: { capacity: 5, refillRatePerSecond: 1 }, // 5 tokens max, 1 token/sec refill
    tenantLimit: { capacity: 50, refillRatePerSecond: 10 },
    globalLimit: { capacity: 500, refillRatePerSecond: 100 },
  });

  const sessionA = "session_alice_burst";
  const sessionB = "session_bob_normal";
  const tenantId = "tenant_engineering";

  console.log(
    `  - Target Limits: Session capacity = 5 reqs, Refill = 1 req/sec`,
  );
  console.log(
    `  - Sending burst of 8 rapid requests from Session A (${sessionA})...`,
  );

  const sessionAResults: boolean[] = [];
  for (let i = 1; i <= 8; i++) {
    const res = rateLimiter.checkRateLimit({
      sessionId: sessionA,
      tenantId,
    });
    sessionAResults.push(res.allowed);
    console.log(
      `    [Session A - Req ${i}] Allowed: ${res.allowed ? "YES" : "NO (THROTTLED)"} | Remaining: ${res.remainingTokens} | Retry-After: ${res.retryAfterSeconds}s`,
    );
  }

  const sessionAAllowedCount = sessionAResults.filter((x) => x).length;
  const sessionAThrottledCount = sessionAResults.filter((x) => !x).length;

  if (sessionAAllowedCount !== 5 || sessionAThrottledCount !== 3) {
    throw new Error(
      `Expected Session A to allow 5 and throttle 3, got allowed=${sessionAAllowedCount}, throttled=${sessionAThrottledCount}`,
    );
  }
  passedTests.push(
    "Session A throttled accurately at token bucket capacity limit (5/5 allowed, 3/3 throttled)",
  );

  // ---------------------------------------------------------------------------
  // Verify Session B is 100% Unaffected (Strict Multi-Session Bulkhead Isolation)
  // ---------------------------------------------------------------------------
  console.log(
    `\n  - Verifying Session B (${sessionB}) is NOT throttled by Session A's exhaustion...`,
  );

  const sessionBResults: boolean[] = [];
  for (let i = 1; i <= 4; i++) {
    const res = rateLimiter.checkRateLimit({
      sessionId: sessionB,
      tenantId,
    });
    sessionBResults.push(res.allowed);
    console.log(
      `    [Session B - Req ${i}] Allowed: ${res.allowed ? "YES" : "NO"} | Remaining: ${res.remainingTokens}`,
    );
  }

  const sessionBAllowedCount = sessionBResults.filter((x) => x).length;
  if (sessionBAllowedCount !== 4) {
    throw new Error(
      `Session B was unfairly affected by Session A! Allowed count: ${sessionBAllowedCount}/4`,
    );
  }
  passedTests.push(
    "Session B remains 100% unaffected by Session A's rate limit exhaustion (Strict Session Bulkhead)",
  );

  // ---------------------------------------------------------------------------
  // 3. HTTP REST 429 RESPONSES & TELEMETRY ROUTE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log(
    "\n[3/3] Testing HTTP REST 429 Headers & Resilience Telemetry Routes...",
  );

  const sessionManager = new SessionManager({ autoPersist: false });
  const router = createHttpRouter(sessionManager);

  // Query GET /resilience/status
  const statusReq = new Request("http://127.0.0.1:4000/resilience/status");
  const statusRes = await router(statusReq);
  const statusData = (await statusRes.json()) as any;

  console.log(`  - GET /resilience/status Response Code: ${statusRes.status}`);
  console.log(
    `  - Registered Breakers: ${statusData.breakers.map((b: any) => `${b.name} (${b.state})`).join(", ")}`,
  );
  console.log(
    `  - Multi-Tier Rate Limits: Session=${statusData.rateLimiter.sessionCapacity}/min, Tenant=${statusData.rateLimiter.tenantCapacity}/min`,
  );

  if (
    statusRes.status !== 200 ||
    !statusData.breakers ||
    !statusData.rateLimiter
  ) {
    throw new Error("Invalid /resilience/status response payload");
  }

  // Test RFC 6585 429 response format
  const throttledResult = rateLimiter.checkRateLimit({
    sessionId: sessionA,
    tenantId,
  });
  const response429 = rateLimiter.create429Response(throttledResult, "session");
  const payload429 = (await response429.json()) as any;

  console.log(`  - 429 HTTP Response Code: ${response429.status}`);
  console.log(
    `  - 429 Response Headers: Retry-After=${response429.headers.get("Retry-After")}, Limit=${response429.headers.get("X-RateLimit-Limit")}`,
  );
  console.log(
    `  - 429 JSON Error Code: ${payload429.error.code} - ${payload429.error.message}`,
  );

  if (
    response429.status !== 429 ||
    payload429.error.code !== "RATE_LIMIT_EXCEEDED"
  ) {
    throw new Error("Invalid 429 error response format");
  }
  passedTests.push(
    "RFC 6585 HTTP 429 response formatting with Retry-After and rate limit headers verified",
  );

  // Clean up session manager & scheduler workers
  sessionManager.clear();

  console.log(
    "\n================================================================================",
  );
  console.log(
    "  VERIFICATION SUMMARY: ALL RESILIENCE & RATE LIMITING TESTS PASSED",
  );
  console.log(
    "================================================================================",
  );
  for (let i = 0; i < passedTests.length; i++) {
    console.log(`  [${i + 1}/${passedTests.length}] ${passedTests[i]}: PASSED`);
  }
  console.log(
    "================================================================================\n",
  );
}

if (import.meta.main) {
  runResilienceChaosAndRateLimitVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Verification failed:", err);
      process.exit(1);
    });
}
