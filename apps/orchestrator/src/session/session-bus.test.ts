import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SessionBus, type PublishResult } from "./session-bus";
import {
  createInterSessionMessage,
  type InterSessionMessage,
} from "./inter-session-message";
import { Session } from "./session";
import { MockModelProvider } from "../provider/mock";

describe("Session-to-Session Communication (Mediator Pattern)", () => {
  let bus: SessionBus;

  beforeEach(() => {
    bus = new SessionBus();
  });

  afterEach(() => {
    bus.clear();
  });

  it("should format subject names following NATS subject addressing standards", () => {
    expect(bus.getSubjectForSession("sess_coord_1")).toBe(
      "sessions.sess_coord_1.inbox",
    );
  });

  it("should deliver messages from coordinator to worker session", async () => {
    const receivedMessages: InterSessionMessage[] = [];

    bus.subscribe("sess_worker_1", (msg) => {
      receivedMessages.push(msg);
    });

    expect(bus.hasSubscriber("sess_worker_1")).toBe(true);

    const message = createInterSessionMessage({
      sourceSessionId: "sess_coord_1",
      targetSessionId: "sess_worker_1",
      type: "delegation",
      task: "Parse configuration file",
      content: "Please check config.yaml syntax",
    });

    const result: PublishResult = await bus.publish(message);

    expect(result.delivered).toBe(true);
    expect(result.subscribersCount).toBe(1);
    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].payload.task).toBe("Parse configuration file");
    expect(receivedMessages[0].sourceSessionId).toBe("sess_coord_1");
  });

  it("should record undeliverable messages and emit alert when target has no active subscriber", async () => {
    let alertEmitted = false;
    let undeliveredMsg: InterSessionMessage | null = null;

    bus.on("undeliverableMessage", (msg: InterSessionMessage, alert: any) => {
      alertEmitted = true;
      undeliveredMsg = msg;
      expect(alert.alert).toBe("UndeliverableInterSessionMessage");
    });

    const message = createInterSessionMessage({
      sourceSessionId: "sess_coord_1",
      targetSessionId: "sess_offline_worker",
      type: "query",
      content: "Are you available?",
    });

    const result = await bus.publish(message);

    expect(result.delivered).toBe(false);
    expect(result.error).toContain("no active subscriber");
    expect(alertEmitted).toBe(true);
    expect(
      undeliveredMsg ? (undeliveredMsg as InterSessionMessage).id : "",
    ).toBe(message.id);

    const deadLetters = bus.getDeadLetters();
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0].targetSessionId).toBe("sess_offline_worker");

    const metrics = bus.getMetrics();
    expect(metrics.totalUndeliverable).toBe(1);
    expect(metrics.deadLetterCount).toBe(1);
  });

  it("should unsubscribe cleanly and remove subject when subscriber disposes", async () => {
    const handler = () => {};
    const unsubscribe = bus.subscribe("sess_temp_1", handler);

    expect(bus.hasSubscriber("sess_temp_1")).toBe(true);

    unsubscribe();

    expect(bus.hasSubscriber("sess_temp_1")).toBe(false);
  });

  it("should integrate with Session actor for cross-session messaging", async () => {
    const mockProvider = new MockModelProvider();
    mockProvider.setNextResponse({
      content: "Worker completed task successfully.",
    });

    const sessionA = new Session({
      sessionId: "sess_coord_actor",
      provider: mockProvider,
      sessionBus: bus,
    });

    const sessionB = new Session({
      sessionId: "sess_worker_actor",
      provider: mockProvider,
      sessionBus: bus,
    });

    let receivedByWorker: InterSessionMessage | null = null;
    sessionB.on("interSessionMessage", (msg: InterSessionMessage) => {
      receivedByWorker = msg;
    });

    const publishResult = await sessionA.sendToSession("sess_worker_actor", {
      type: "delegation",
      task: "Compute prime factors",
      content: "Calculate factors for N = 104729",
    });

    expect(publishResult.delivered).toBe(true);
    expect(receivedByWorker).toBeDefined();
    expect(
      (receivedByWorker as InterSessionMessage | null)?.sourceSessionId,
    ).toBe("sess_coord_actor");

    const workerMessages = sessionB.getMessages();
    const lastMsg = workerMessages[workerMessages.length - 1];
    expect(lastMsg.role).toBe("system");
    expect(lastMsg.content).toContain(
      "[Inter-Session Message from sess_coord_actor (delegation)]",
    );
    expect(lastMsg.content).toContain("Calculate factors for N = 104729");

    sessionA.dispose();
    sessionB.dispose();
  });
});
