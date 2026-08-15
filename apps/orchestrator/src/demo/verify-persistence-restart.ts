import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { calculatorTool, getCurrentTimeTool } from "../tools/builtin";
import { MockModelProvider } from "../provider/mock";
import {
  SessionRepository,
  RunRepository,
  RedisSessionStore,
  closePostgres,
} from "../persistence";

async function runEndToEndPersistenceTest() {
  console.log("\n============================================================");
  console.log("🚀 STARTING CRUCIBLE STATE & SESSION PERSISTENCE VERIFICATION");
  console.log("============================================================\n");

  const sessionId = `sess_survive_${Date.now()}`;
  const sessionRepo = new SessionRepository();
  const runRepo = new RunRepository();
  const redisStore = new RedisSessionStore();

  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(getCurrentTimeTool);

  // ------------------------------------------------------------------------
  // STEP 1: ORCHESTRATOR PROCESS 1 (INITIAL BOOT)
  // ------------------------------------------------------------------------
  console.log("📦 [Process 1] Initializing Orchestrator instance 1...");
  const orchestrator1 = new SessionManager({
    defaultProvider: new MockModelProvider(),
    defaultTools: tools,
    sessionRepository: sessionRepo,
    runRepository: runRepo,
    redisStore,
    autoPersist: true,
  });

  console.log(`\n📝 [Process 1] Creating persistent session: ${sessionId}`);
  const session1 = await orchestrator1.createSessionAsync({
    sessionId,
    title: "Crucible Persistence Proof Session",
    systemPrompt:
      "You are Crucible assistant with tool execution capabilities.",
  });

  console.log(`✨ [Process 1] Session created with ID: ${session1.id}`);

  // Send Message 1
  console.log("\n💬 [Process 1] Sending Turn 1: 'Calculate 25 * 4'");
  const result1 = await orchestrator1.dispatch(sessionId, "Calculate 25 * 4");
  console.log(
    `✅ [Process 1] Turn 1 Result: "${result1.finalResponse}" (state: ${result1.state})`,
  );

  // Send Message 2
  console.log("\n💬 [Process 1] Sending Turn 2: 'What is the current time?'");
  const result2 = await orchestrator1.dispatch(
    sessionId,
    "What is the current time?",
  );
  console.log(
    `✅ [Process 1] Turn 2 Result: "${result2.finalResponse}" (state: ${result2.state})`,
  );

  const summary1 = session1.getSummary();
  console.log("\n📊 [Process 1] Pre-restart Session Summary:");
  console.log({
    sessionId: summary1.id,
    turnCount: summary1.turnCount,
    messageCount: summary1.messageCount,
    status: summary1.status,
  });

  // Verify directly in PostgreSQL
  const dbRecord = await sessionRepo.getSession(sessionId);
  console.log("\n🗄️ [PostgreSQL] Direct DB verification before restart:");
  console.log(`   - DB Session Exists: ${!!dbRecord}`);
  console.log(`   - Persisted Turns: ${dbRecord?.turns.length}`);
  console.log(
    `   - Persisted Tool Calls: ${dbRecord?.turns.reduce((acc, t) => acc + t.toolCalls.length, 0)}`,
  );

  // Verify Event Sourcing stream
  const events = await runRepo.getEvents(sessionId);
  console.log(`   - Event Sourcing Events Count: ${events.length}`);
  console.log(
    `   - Event Stream: [${events.map((e) => e.eventType).join(" -> ")}]`,
  );

  // ------------------------------------------------------------------------
  // STEP 2: SIMULATE HARSH PROCESS CRASH / RESTART
  // ------------------------------------------------------------------------
  console.log(
    "\n💥 [Simulation] CRASHING / SHUTTING DOWN Orchestrator Process 1...",
  );
  orchestrator1.clear(); // Clears all in-memory state
  console.log(
    "🛑 [Process 1] Process 1 memory wiped. Active sessions in memory: 0.",
  );

  // ------------------------------------------------------------------------
  // STEP 3: ORCHESTRATOR PROCESS 2 (POST-RESTART RECOVERY)
  // ------------------------------------------------------------------------
  console.log("\n🔄 [Process 2] Starting brand-new Orchestrator Process 2...");
  const orchestrator2 = new SessionManager({
    defaultProvider: new MockModelProvider(),
    defaultTools: tools,
    sessionRepository: sessionRepo,
    runRepository: runRepo,
    redisStore,
    autoPersist: true,
  });

  console.log(`   - In-memory count before restore: ${orchestrator2.count()}`);
  console.log("   - Restoring sessions from PostgreSQL persistence...");
  const restoredCount = await orchestrator2.restoreFromPersistence();
  console.log(
    `✨ [Process 2] Successfully restored ${restoredCount} session(s) from database!`,
  );
  console.log(`   - In-memory count after restore: ${orchestrator2.count()}`);

  const restoredSession = orchestrator2.get(sessionId);
  if (!restoredSession) {
    throw new Error(
      `❌ FAILED: Session ${sessionId} was NOT restored in Process 2!`,
    );
  }

  const restoredSummary = restoredSession.getSummary();
  console.log("\n📋 [Process 2] Restored Session Details:");
  console.log({
    sessionId: restoredSummary.id,
    title: restoredSummary.title,
    turnCount: restoredSummary.turnCount,
    messageCount: restoredSummary.messageCount,
    status: restoredSummary.status,
  });

  if (restoredSummary.turnCount !== 2) {
    throw new Error(
      `❌ FAILED: Expected turnCount=2, got ${restoredSummary.turnCount}`,
    );
  }

  // ------------------------------------------------------------------------
  // STEP 4: RESUME SESSION IN PROCESS 2 (SEND TURN 3)
  // ------------------------------------------------------------------------
  console.log("\n🚀 [Process 2] Resuming restored session: Sending Turn 3...");
  const result3 = await orchestrator2.dispatch(sessionId, "Calculate 100 + 50");
  console.log(
    `✅ [Process 2] Turn 3 Result: "${result3.finalResponse}" (state: ${result3.state})`,
  );

  const finalSummary = restoredSession.getSummary();
  console.log("\n📈 [Process 2] Final Session Summary After Resumption:");
  console.log({
    sessionId: finalSummary.id,
    turnCount: finalSummary.turnCount,
    messageCount: finalSummary.messageCount,
    status: finalSummary.status,
  });

  // Verify final DB state has 3 turns
  const finalDbRecord = await sessionRepo.getSession(sessionId);
  console.log(
    `\n🗄️ [PostgreSQL] Final DB Turns Count: ${finalDbRecord?.turns.length}`,
  );

  if (finalDbRecord?.turns.length !== 3) {
    throw new Error(
      `❌ FAILED: Expected 3 turns in PostgreSQL, found ${finalDbRecord?.turns.length}`,
    );
  }

  // Clean up test session
  orchestrator2.delete(sessionId);
  await redisStore.close();
  await closePostgres();

  console.log("\n============================================================");
  console.log("🎉 VERIFICATION PASSED: SESSION SURVIVED RESTART AND RESUMED!");
  console.log("============================================================\n");
}

runEndToEndPersistenceTest().catch((err) => {
  console.error("❌ Persistence verification failed:", err);
  process.exit(1);
});
