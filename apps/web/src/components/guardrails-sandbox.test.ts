import { describe, expect, it } from "bun:test";
import { OrchestratorClient } from "../api/orchestrator-client";

describe("Web Client Guardrails & Sandbox Integration", () => {
  it("should have typed methods on OrchestratorClient for approval and sandbox", () => {
    const client = new OrchestratorClient("http://localhost:4000");
    expect(typeof client.approveGuardrailAction).toBe("function");
    expect(typeof client.getSandboxInfo).toBe("function");
  });

  it("should format request payloads correctly in approveGuardrailAction", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: any = null;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || "GET";
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return new Response(
        JSON.stringify({
          sessionId: "sess_test",
          action: "approved",
          operatorId: "human_operator_ui",
          status: "running",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    // Temporarily replace global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const client = new OrchestratorClient("http://localhost:4000");
      const res = await client.approveGuardrailAction("sess_test", {
        approved: true,
        toolCallId: "call_123",
        operatorId: "operator_alice",
        resume: true,
      });

      expect(capturedUrl).toBe(
        "http://localhost:4000/sessions/sess_test/approval",
      );
      expect(capturedMethod).toBe("POST");
      expect(capturedBody.approved).toBe(true);
      expect(capturedBody.operatorId).toBe("operator_alice");
      expect(res.action).toBe("approved");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should fetch sandbox info correctly via getSandboxInfo", async () => {
    let capturedUrl = "";

    const mockFetch = async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          status: "active",
          tier: "Rust gRPC + cgroups v2",
          executor: "grpc",
          cgroups: {
            enabled: true,
            cpuQuota: "200%",
            memoryLimit: "512 MB",
            pidsLimit: 256,
            memoryCurrent: "35 MB",
          },
          filesystem: {
            isolation: "OverlayFS",
            strategy: "native_kernel",
            writableLayer: "ephemeral",
            cleanup: "RAII",
          },
          network: {
            policy: "airgap",
            egress: "deny_all",
            protocols: ["DNS", "HTTPS"],
            nftables: "active",
          },
          guardrails: {
            status: "enforced",
            activePolicies: ["irreversible_action"],
            pendingHumanReview: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const client = new OrchestratorClient("http://localhost:4000");
      const info = await client.getSandboxInfo("sess_456");
      expect(capturedUrl).toBe(
        "http://localhost:4000/sessions/sess_456/sandbox",
      );
      expect(info.status).toBe("active");
      expect(info.cgroups.enabled).toBe(true);
      expect(info.cgroups.memoryLimit).toBe("512 MB");
      expect(info.filesystem.isolation).toBe("OverlayFS");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
