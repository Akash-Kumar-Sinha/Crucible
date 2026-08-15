import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import {
  SessionRepository,
  RunRepository,
  RedisSessionStore,
  checkPostgresHealth,
  closePostgres,
} from "./index";
import { runPostgresMigrations } from "./postgres/migrator";
import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { MockModelProvider } from "../provider/mock";

describe("State & Session Persistence Subsystem (Postgres & Redis)", () => {
  let sessionRepo: SessionRepository;
  let runRepo: RunRepository;
  let redisStore: RedisSessionStore;
  let isDbAvailable = false;
  const testSessionId = `test_sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  beforeAll(async () => {
    try {
      const health = await checkPostgresHealth();
      if (health.ok) {
        await runPostgresMigrations();
        isDbAvailable = true;
      }
    } catch {
      isDbAvailable = false;
    }

    sessionRepo = new SessionRepository();
    runRepo = new RunRepository();
    redisStore = new RedisSessionStore();
  });

  afterAll(async () => {
    if (isDbAvailable) {
      try {
        await sessionRepo.deleteSession(testSessionId);
      } catch (err) {
        console.warn("Failed to clean up persistence test session", err);
      }
    }
    await redisStore.close();
    await closePostgres();
  });

  it("should persist session lifecycle and turns in PostgreSQL via Prisma (Repository Pattern)", async () => {
    if (!isDbAvailable) {
      console.log("PostgreSQL offline: skipping DB persistence test");
      return;
    }
    // 1. Create session
    const session = await sessionRepo.createSession({
      id: testSessionId,
      title: "Persistence Test Session",
      systemPrompt: "System instruction test",
      modelSlug: "test-model-1",
      metadata: { env: "test" },
    });

    expect(session.id).toBe(testSessionId);
    expect(session.title).toBe("Persistence Test Session");

    // 2. Update session status
    const updated = await sessionRepo.updateSession(testSessionId, {
      status: "running",
      agentState: "awaiting_tool",
    });
    expect(updated?.status).toBe("running");
    expect(updated?.agentState).toBe("awaiting_tool");

    // 3. Record turn with tool calls
    const turn = await sessionRepo.recordTurn(testSessionId, 1, {
      thought: "Analyzing files...",
      modelOutput: "Done reading files",
      durationMs: 150,
      toolCalls: [
        {
          id: `call_${Date.now()}`,
          name: "read_file",
          arguments: { path: "/workspace/config.json" },
          status: "SUCCESS",
          stdout: "file contents",
          durationMs: 25,
        },
      ],
    });

    expect(turn.turnNumber).toBe(1);
    expect(turn.thought).toBe("Analyzing files...");
    expect(turn.toolCalls.length).toBe(1);
    expect(turn.toolCalls[0].name).toBe("read_file");

    // 4. Retrieve complete session detail
    const detail = await sessionRepo.getSession(testSessionId);
    expect(detail).toBeDefined();
    expect(detail?.turns.length).toBe(1);
    expect(detail?.turns[0].toolCalls.length).toBe(1);
  });

  it("should append and replay events using Event Sourcing Pattern", async () => {
    if (!isDbAvailable) {
      console.log("PostgreSQL offline: skipping event sourcing test");
      return;
    }
    const esSessionId = `es_sess_${Date.now()}`;

    // Ensure session parent exists
    await sessionRepo.createSession({
      id: esSessionId,
      title: "Event Sourcing Test",
    });

    // Append event sequence
    const ev1 = await runRepo.appendEvent(esSessionId, "SESSION_CREATED", {
      title: "Event Sourcing Test",
      modelSlug: "es-model",
    });
    expect(ev1.sequenceNumber).toBe(1);

    const ev2 = await runRepo.appendEvent(esSessionId, "STEP_TRANSITION", {
      to: "awaiting_tool",
    });
    expect(ev2.sequenceNumber).toBe(2);

    const ev3 = await runRepo.appendEvent(esSessionId, "MODEL_COMPLETION", {
      turnNumber: 1,
      modelOutput: "Execution successful",
    });
    expect(ev3.sequenceNumber).toBe(3);

    const ev4 = await runRepo.appendEvent(esSessionId, "SESSION_COMPLETED", {});
    expect(ev4.sequenceNumber).toBe(4);

    // Fetch full event stream
    const events = await runRepo.getEvents(esSessionId);
    expect(events.length).toBe(4);
    expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3, 4]);

    // Replay events to reconstruct state
    const replayed = await runRepo.replayEvents(esSessionId);
    expect(replayed.sessionId).toBe(esSessionId);
    expect(replayed.status).toBe("done");
    expect(replayed.agentState).toBe("awaiting_tool");
    expect(replayed.turnCount).toBe(1);
    expect(replayed.eventsCount).toBe(4);

    await sessionRepo.deleteSession(esSessionId);
  });

  it("should store and retrieve hot session state in Redis", async () => {
    const hotSessionId = `hot_${Date.now()}`;

    const ok = await redisStore.setHotState(
      hotSessionId,
      {
        sessionId: hotSessionId,
        status: "running",
        agentState: "awaiting_model",
        title: "Hot Cache Session",
        modelSlug: "quick-model",
        turnCount: 2,
        lastActiveAt: Date.now(),
      },
      60,
    );

    // If redis server is running, verify retrieval
    if (ok) {
      const cached = await redisStore.getHotState(hotSessionId);
      expect(cached).toBeDefined();
      expect(cached?.sessionId).toBe(hotSessionId);
      expect(cached?.status).toBe("running");

      await redisStore.deleteHotState(hotSessionId);
      const afterDelete = await redisStore.getHotState(hotSessionId);
      expect(afterDelete).toBeNull();
    }
  });

  it("should restore sessions and turns across orchestrator restarts", async () => {
    if (!isDbAvailable) {
      console.log("PostgreSQL offline: skipping restart restoration test");
      return;
    }
    const restartSessionId = `restart_sess_${Date.now()}`;

    // Manager Instance 1: Creates session and persists turn
    const manager1 = new SessionManager({
      defaultProvider: new MockModelProvider(),
      defaultTools: new ToolRegistry(),
      sessionRepository: sessionRepo,
      runRepository: runRepo,
      redisStore,
      autoPersist: true,
    });

    const _s1 = await manager1.createSessionAsync({
      sessionId: restartSessionId,
      title: "Cross Restart Session",
    });

    await sessionRepo.recordTurn(restartSessionId, 1, {
      thought: "Initial reasoning before crash",
      modelOutput: "Hello from pre-restart",
    });

    // Simulate Orchestrator process crash / restart: Discard manager1
    manager1.clear();

    // Manager Instance 2: Boots up fresh with empty in-memory state
    const manager2 = new SessionManager({
      defaultProvider: new MockModelProvider(),
      defaultTools: new ToolRegistry(),
      sessionRepository: sessionRepo,
      runRepository: runRepo,
      redisStore,
      autoPersist: true,
    });

    expect(manager2.count()).toBe(0);

    // Restore from PostgreSQL database
    const restoredCount = await manager2.restoreFromPersistence();
    expect(restoredCount).toBeGreaterThanOrEqual(1);
    expect(manager2.has(restartSessionId)).toBe(true);

    const restoredSession = manager2.get(restartSessionId);
    expect(restoredSession?.title).toBe("Cross Restart Session");
    expect(
      restoredSession?.getContext().messages.length,
    ).toBeGreaterThanOrEqual(1);

    // Cleanup
    manager2.delete(restartSessionId);
  });
});
