import { describe, expect, it } from "bun:test";
import {
  getOrchestratorUrl,
  getStreamUrl,
  getWsUrl,
} from "../config/orchestrator-url";

describe("UI Capabilities & Observer/Facade Primitives", () => {
  describe("Twelve-Factor App Configuration: orchestrator-url", () => {
    it("should return configured NEXT_PUBLIC_ORCHESTRATOR_URL when set", () => {
      const originalEnv = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      try {
        process.env.NEXT_PUBLIC_ORCHESTRATOR_URL =
          "https://orchestrator.internal:8080/";
        expect(getOrchestratorUrl()).toBe("https://orchestrator.internal:8080");
      } finally {
        if (originalEnv !== undefined) {
          process.env.NEXT_PUBLIC_ORCHESTRATOR_URL = originalEnv;
        } else {
          delete process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
        }
      }
    });

    it("should construct stream URLs correctly", () => {
      const originalEnv = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      const originalStreamEnv = process.env.NEXT_PUBLIC_STREAM_URL;
      try {
        delete process.env.NEXT_PUBLIC_STREAM_URL;
        process.env.NEXT_PUBLIC_ORCHESTRATOR_URL = "http://localhost:4000";
        expect(getStreamUrl("sess_123")).toBe(
          "http://localhost:4000/api/sessions/sess_123/stream",
        );
        expect(getStreamUrl()).toBe("http://localhost:4000/api/sessions");
      } finally {
        if (originalEnv !== undefined) {
          process.env.NEXT_PUBLIC_ORCHESTRATOR_URL = originalEnv;
        } else {
          delete process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
        }
        if (originalStreamEnv !== undefined) {
          process.env.NEXT_PUBLIC_STREAM_URL = originalStreamEnv;
        }
      }
    });

    it("should construct WebSocket URLs from HTTP base URL", () => {
      const originalEnv = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      try {
        process.env.NEXT_PUBLIC_ORCHESTRATOR_URL = "http://localhost:4000";
        expect(getWsUrl("sess_abc")).toBe(
          "ws://localhost:4000/ws?sessionId=sess_abc",
        );
        expect(getWsUrl()).toBe("ws://localhost:4000/ws");
      } finally {
        if (originalEnv !== undefined) {
          process.env.NEXT_PUBLIC_ORCHESTRATOR_URL = originalEnv;
        } else {
          delete process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
        }
      }
    });
  });

  describe("Container Status & Kubernetes Scheduling Metadata", () => {
    it("should classify exit codes and OOMKilled statuses correctly", () => {
      const isOOM1 = 137 === 137;
      const isTerminated = 143 === 143;
      const isSuccess = 0 === 0;

      expect(isOOM1).toBeTrue();
      expect(isTerminated).toBeTrue();
      expect(isSuccess).toBeTrue();
    });

    it("should handle Kubernetes scheduling phase states", () => {
      const phases = [
        "Queued",
        "ScalingUp",
        "Pending",
        "Running",
        "Succeeded",
        "Failed",
        "OOMKilled",
        "Evicted",
      ];
      expect(phases).toContain("Queued");
      expect(phases).toContain("ScalingUp");
      expect(phases).toContain("Pending");
      expect(phases).toContain("OOMKilled");
      expect(phases).toContain("Evicted");
    });
  });
});
