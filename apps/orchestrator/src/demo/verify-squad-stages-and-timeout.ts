import { SessionManager } from "../session/session-manager";
import { SquadManager } from "../squad/squad-manager";
import { getSessionBus } from "../session/session-bus";
import { getErrorReporter } from "../observability/error-reporter";

export async function runSquadStagesAndTimeoutVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "CRUCIBLE MULTI-AGENT SQUAD VERIFICATION: 4-STAGE PIPELINE & STALL TIMEOUT ALERT",
  );
  console.log(
    "================================================================================\n",
  );

  const sessionBus = getSessionBus();
  sessionBus.clear();
  const errorReporter = getErrorReporter();
  errorReporter.resetMetrics();

  const sessionManager = new SessionManager({
    defaultMaxSteps: 5,
    autoPersist: false,
  });
  const squadManager = new SquadManager(sessionManager);

  // ============================================================================
  // Part 1: Four-Stage Automated Pipeline with Sequential Notifications
  // ============================================================================
  console.log(
    "--- [1/2] 4-STAGE SQUAD EXECUTION & SEQUENTIAL HAND-OFF NOTIFICATIONS ---",
  );

  const squad = await squadManager.createSquad({
    name: "Distributed Systems Squad",
    autoCreateSessions: true,
  });

  const members = squad.getMembers();
  const coderSessionId = members.get("coder")!.sessionId;
  const testWriterSessionId = members.get("test_writer")!.sessionId;
  const bugHunterSessionId = members.get("bug_hunter")!.sessionId;
  const bugFixerSessionId = members.get("bug_fixer")!.sessionId;

  console.log(`[Squad Provisioned] Squad ID: ${squad.id} ("${squad.name}")`);
  console.log(`  -> Coder:       ${coderSessionId}`);
  console.log(`  -> Test Writer: ${testWriterSessionId}`);
  console.log(`  -> Bug Hunter:  ${bugHunterSessionId}`);
  console.log(`  -> Bug Fixer:   ${bugFixerSessionId}\n`);

  // Track message arrivals per session
  const inboxMessages: Record<string, any[]> = {
    [coderSessionId]: [],
    [testWriterSessionId]: [],
    [bugHunterSessionId]: [],
    [bugFixerSessionId]: [],
  };

  for (const sessId of Object.keys(inboxMessages)) {
    sessionBus.subscribe(sessId, (msg) => {
      inboxMessages[sessId].push(msg);
    });
  }

  // 1. Kick off squad on task
  console.log(
    "[Stage 1: CODING] Starting squad goal: 'Implement Distributed Token Bucket Rate Limiter'...",
  );
  await squad.start("Implement Distributed Token Bucket Rate Limiter");

  console.log(`  -> Current Stage: ${squad.getStage().toUpperCase()}`);
  console.log(
    `  -> Coder Inbox Count:       ${inboxMessages[coderSessionId].length}`,
  );
  console.log(
    `  -> Test Writer Inbox Count: ${inboxMessages[testWriterSessionId].length} (Should be 0 - not notified yet)`,
  );

  if (inboxMessages[testWriterSessionId].length !== 0) {
    throw new Error(
      "FAIL: Test Writer received premature notification before Coder completed!",
    );
  }

  // 2. Coder finishes -> hands off to Test Writer
  console.log("\n[Hand-off 1 -> 2] Coder completes turn...");
  await squad.handleTurnCompleted(
    "coder",
    coderSessionId,
    "Implemented Redis-backed token bucket algorithm with atomic Lua script",
  );

  console.log(`  -> Current Stage: ${squad.getStage().toUpperCase()}`);
  console.log(
    `  -> Test Writer Inbox Count: ${inboxMessages[testWriterSessionId].length} (Received hand-off delegation)`,
  );
  console.log(
    `  -> Bug Hunter Inbox Count:  ${inboxMessages[bugHunterSessionId].length} (Should be 0 - waiting for tests)`,
  );

  if (
    inboxMessages[testWriterSessionId].length === 0 ||
    inboxMessages[bugHunterSessionId].length !== 0
  ) {
    throw new Error("FAIL: Hand-off routing to Test Writer failed!");
  }

  // 3. Test Writer passes -> hands off to Bug Hunter
  console.log(
    "\n[Hand-off 2 -> 3] Test Writer completes test suite verification...",
  );
  await squad.handleTurnCompleted(
    "test_writer",
    testWriterSessionId,
    "All 24 unit and integration tests passed cleanly in 82ms. 0 failures.",
  );

  console.log(`  -> Current Stage: ${squad.getStage().toUpperCase()}`);
  console.log(
    `  -> Bug Hunter Inbox Count: ${inboxMessages[bugHunterSessionId].length} (Received security audit delegation)`,
  );
  console.log(
    `  -> Bug Fixer Inbox Count:  ${inboxMessages[bugFixerSessionId].length} (Should be 0 - waiting for audit)`,
  );

  if (
    inboxMessages[bugHunterSessionId].length === 0 ||
    inboxMessages[bugFixerSessionId].length !== 0
  ) {
    throw new Error("FAIL: Hand-off routing to Bug Hunter failed!");
  }

  // 4. Bug Hunter finds vulnerability -> hands off to Bug Fixer
  console.log(
    "\n[Hand-off 3 -> 4] Bug Hunter detects vulnerability during security probing...",
  );
  await squad.handleTurnCompleted(
    "bug_hunter",
    bugHunterSessionId,
    "Vulnerability Found: Potential integer overflow in timestamp delta calculation under leap seconds.",
  );

  console.log(`  -> Current Stage: ${squad.getStage().toUpperCase()}`);
  console.log(
    `  -> Bug Fixer Inbox Count: ${inboxMessages[bugFixerSessionId].length} (Received vulnerability remediation task)`,
  );

  if (inboxMessages[bugFixerSessionId].length === 0) {
    throw new Error("FAIL: Hand-off routing to Bug Fixer failed!");
  }

  // 5. Bug Fixer patches -> Test Writer re-tests -> Bug Hunter certifies -> COMPLETED
  console.log(
    "\n[Closing Remediation Loop] Bug Fixer applies patch and re-triggers validation...",
  );
  await squad.handleTurnCompleted(
    "bug_fixer",
    bugFixerSessionId,
    "Patched timestamp arithmetic using BigInt monotonic milliseconds.",
  );
  console.log(
    `  -> Stage after Fixer patch: ${squad.getStage().toUpperCase()} (Re-testing)`,
  );

  await squad.handleTurnCompleted(
    "test_writer",
    testWriterSessionId,
    "Regression test suite passed with 100% assertions green.",
  );
  console.log(
    `  -> Stage after re-test: ${squad.getStage().toUpperCase()} (Final Audit)`,
  );

  await squad.handleTurnCompleted(
    "bug_hunter",
    bugHunterSessionId,
    "Security Audit Certified: 0 vulnerabilities found. Ready for deployment.",
  );
  console.log(`  -> Final Stage: ${squad.getStage().toUpperCase()}`);

  if (squad.getStage() !== "completed") {
    throw new Error(
      `FAIL: Expected squad to be in 'completed' stage, found '${squad.getStage()}'`,
    );
  }

  // ============================================================================
  // Part 2: Stalled Stage Detection & Timeout Alert
  // ============================================================================
  console.log(
    "\n--- [2/2] STALLED STAGE DETECTION & TIMEOUT ALERT EMISSION ---",
  );

  let stalledAlertFired = false;
  let capturedStallPayload: any = null;

  errorReporter.on("squadStalledAlert", (payload) => {
    stalledAlertFired = true;
    capturedStallPayload = payload;
  });

  const timeoutSquad = await squadManager.createSquad({
    name: "Stalling Stage Test Squad",
    stageTimeoutMs: 30, // 30ms tight threshold
    autoCreateSessions: true,
  });

  console.log(
    `[Timeout Squad Setup] Initialized squad with stageTimeoutMs = 30ms`,
  );
  await timeoutSquad.start("Compute long running factorization");
  console.log(
    `  -> Squad started in stage: ${timeoutSquad.getStage().toUpperCase()}`,
  );

  console.log(
    "  -> Deliberately stalling for 60ms without completing stage hand-off...",
  );
  await new Promise((resolve) => setTimeout(resolve, 60));

  console.log("  -> Executing health check checkStall()...");
  const isStalled = timeoutSquad.checkStall();

  console.log(`  -> checkStall() returned: ${isStalled}`);
  console.log(
    `  -> Final Squad Stage:   ${timeoutSquad.getStage().toUpperCase()}`,
  );
  console.log(
    `  -> Squad Status Line:   "${timeoutSquad.getSummary().statusLine}"`,
  );
  console.log(`  -> Timeout Alert Fired: ${stalledAlertFired}`);
  if (capturedStallPayload) {
    const ctx = capturedStallPayload.context || capturedStallPayload;
    console.log(
      `  -> Alert Payload:       [Stage: ${ctx.stage}, Elapsed: ${ctx.elapsedMs}ms, Timeout: ${ctx.timeoutMs}ms]`,
    );
    console.log(`  -> Structured Error ID: ${capturedStallPayload.id}`);
  }

  if (
    !isStalled ||
    timeoutSquad.getStage() !== "stalled" ||
    !stalledAlertFired
  ) {
    throw new Error(
      "FAIL: Stalled stage was not detected or timeout alert failed to fire!",
    );
  }

  console.log(
    "\n================================================================================",
  );
  console.log(
    "SQUAD 4-STAGE PIPELINE & STALL TIMEOUT VERIFICATION PASSED (0 FAILURES)",
  );
  console.log(
    "================================================================================",
  );

  squadManager.clear();
  sessionManager.clear();
  process.exit(0);
}

if (import.meta.main) {
  runSquadStagesAndTimeoutVerification().catch((err) => {
    console.error("Squad stages and timeout verification failed:", err);
    process.exit(1);
  });
}
