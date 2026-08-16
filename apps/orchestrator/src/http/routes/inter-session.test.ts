import { describe, it, expect, beforeEach } from "bun:test";
import { InterSessionRouteHandler } from "./inter-session";
import { getSessionBus } from "../../session/session-bus";

describe("InterSessionRouteHandler & Wildcard Subscriptions", () => {
  const bus = getSessionBus();

  beforeEach(() => {
    bus.clear();
  });

  it("should return empty message feed initially", async () => {
    const handler = new InterSessionRouteHandler();
    const url = new URL(
      "http://localhost:4000/inter-session/messages?limit=20",
    );
    const response = await handler.getMessages(url);

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.status).toBe("success");
    expect(Array.isArray(body.data.messages)).toBe(true);
    expect(body.data.metrics).toBeDefined();
  });

  it("should record published inter-session messages in recent messages buffer", async () => {
    const handler = new InterSessionRouteHandler();

    // Register a subscriber on target session
    const received: any[] = [];
    bus.subscribe("sess_target_worker", (msg) => {
      received.push(msg);
    });

    const msgPayload = {
      id: "msg_cross_1",
      sourceSessionId: "sess_coord_main",
      targetSessionId: "sess_target_worker",
      type: "delegation",
      payload: { task: "Run security audit on auth module" },
      timestamp: Date.now(),
    };

    const req = new Request("http://localhost:4000/inter-session/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msgPayload),
    });

    const response = await handler.publishMessage(req);
    expect(response.status).toBe(200);

    expect(received.length).toBe(1);
    expect(received[0].id).toBe("msg_cross_1");

    // Fetch feed
    const url = new URL("http://localhost:4000/inter-session/messages");
    const feedRes = await handler.getMessages(url);
    const feedBody = (await feedRes.json()) as any;

    expect(feedBody.data.messages.length).toBeGreaterThanOrEqual(1);
    expect(feedBody.data.messages[0].id).toBe("msg_cross_1");
  });

  it("should dispatch to wildcard subscribers (sessions.*.inbox)", async () => {
    const wildcardReceived: any[] = [];
    const directReceived: any[] = [];

    bus.subscribe("sess_worker_a", (msg) => {
      directReceived.push(msg);
    });

    bus.subscribeAll((msg) => {
      wildcardReceived.push(msg);
    });

    await bus.publish({
      id: "msg_wildcard_test",
      sourceSessionId: "sess_leader",
      targetSessionId: "sess_worker_a",
      type: "event",
      payload: { event: "CLUSTER_LEADER_ELECTED" },
      timestamp: Date.now(),
    });

    expect(directReceived.length).toBe(1);
    expect(wildcardReceived.length).toBe(1);
    expect(wildcardReceived[0].id).toBe("msg_wildcard_test");
  });
});
