import { describe, expect, it } from "bun:test";
import { SessionStreamClient } from "./stream-client";

describe("Web UI SessionStreamClient", () => {
  it("should initialize with default options", () => {
    const client = new SessionStreamClient("test_sess_123");
    expect(client.sessionId).toBe("test_sess_123");
    expect(client.isConnected()).toBe(false);
  });

  it("should register and trigger event listeners", () => {
    const client = new SessionStreamClient("test_sess_456");
    const receivedTokens: string[] = [];

    const unsubscribe = client.on("token", (data) => {
      receivedTokens.push(data.delta);
    });

    // Manually emit to internal observer
    (client as any).emit("token", { delta: "ChunkA" });
    (client as any).emit("token", { delta: "ChunkB" });

    expect(receivedTokens).toEqual(["ChunkA", "ChunkB"]);

    unsubscribe();
    (client as any).emit("token", { delta: "ChunkC" });
    expect(receivedTokens).toEqual(["ChunkA", "ChunkB"]);
  });

  it("should notify connection state changes", () => {
    const client = new SessionStreamClient("test_sess_789");
    const connectionStates: boolean[] = [];

    client.onConnectionChange((connected) => {
      connectionStates.push(connected);
    });

    (client as any).setConnected(true);
    (client as any).setConnected(false);

    expect(connectionStates).toEqual([false, true, false]);
  });
});
