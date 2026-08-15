import { describe, expect, it } from "bun:test";
import { SessionManager } from "../../session/session-manager";
import { ToolRegistry } from "../../tools/registry";
import { createHttpRouter } from "../server";
import { MockModelProvider } from "../../provider/mock";
import { GuardrailChain } from "../../guardrails/chain";
import { IrreversibleActionPolicy } from "../../guardrails/policies/irreversible-action";

describe("Guardrail & Sandbox HTTP Routes", () => {
  const mock = new MockModelProvider();
  const tools = new ToolRegistry();
  const guardrails = new GuardrailChain({
    policies: [new IrreversibleActionPolicy()],
  });
  const sessionManager = new SessionManager({
    defaultProvider: mock,
    defaultTools: tools,
    defaultGuardrails: guardrails,
  });
  const router = createHttpRouter(sessionManager);

  it("should return sandbox info from GET /sandbox/info", async () => {
    const req = new Request("http://localhost:4000/sandbox/info", {
      method: "GET",
    });
    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("active");
    expect(body.cgroups.enabled).toBe(true);
    expect(body.cgroups.cpuQuota).toBeDefined();
    expect(body.filesystem.isolation).toBeDefined();
    expect(body.network.policy).toBeDefined();
    expect(body.guardrails.activePolicies).toContain("irreversible_action");
  });

  it("should return session-specific sandbox info from GET /sessions/:id/sandbox", async () => {
    const session = sessionManager.createSession({
      title: "Sandbox Test Session",
    });
    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/sandbox`,
      { method: "GET" },
    );
    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guardrails.pendingHumanReview).toBe(false);
  });

  it("should process human approval via POST /sessions/:id/approval", async () => {
    const session = sessionManager.createSession({ title: "Approval Session" });
    session.restoreState({ status: "awaiting_human" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: true,
          toolCallId: "call_abc123",
          operatorId: "test_operator",
          resume: false,
        }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe(session.id);
    expect(body.action).toBe("approved");
    expect(body.operatorId).toBe("test_operator");
  });

  it("should process human rejection via POST /sessions/:id/guardrails/approval", async () => {
    const session = sessionManager.createSession({
      title: "Rejection Session",
    });
    session.restoreState({ status: "awaiting_human" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/guardrails/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: false,
          reason: "Dangerous root modification prohibited",
          toolCallId: "call_def456",
          operatorId: "security_admin",
          resume: false,
        }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe(session.id);
    expect(body.action).toBe("rejected");
    expect(body.operatorId).toBe("security_admin");
  });

  it("should return 404 for approval on non-existent session", async () => {
    const req = new Request(
      "http://localhost:4000/sessions/sess_non_existent/approval",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });
});
