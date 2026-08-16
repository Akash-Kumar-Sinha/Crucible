import { describe, it, expect, beforeEach } from "bun:test";
import { InfraStatusRouteHandler } from "./infra-status";
import { SessionManager } from "../../session/session-manager";

describe("InfraStatusRouteHandler (Facade Pattern)", () => {
  let sessionManager: SessionManager;
  let handler: InfraStatusRouteHandler;

  beforeEach(() => {
    sessionManager = new SessionManager();
    handler = new InfraStatusRouteHandler(sessionManager);
  });

  it("should return cluster-wide infra status on GET /infra/status", async () => {
    const req = new Request("http://localhost:4000/infra/status", {
      method: "GET",
    });

    const res = await handler.getInfraStatus(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.status).toBe("success");
    expect(json.data).toBeDefined();
    expect(json.data.kubernetes.clusterConnected).toBe(true);
    expect(json.data.kubernetes.namespace).toBe("crucible");
    expect(json.data.queue).toBeDefined();
    expect(json.data.queue.status).toBe("idle");
    expect(json.data.tenant).toBeDefined();
    expect(json.data.tenant.activeTenantId).toBe("default");
    expect(json.data.tenant.availableTenants).toContain("default");
  });

  it("should return session-specific infra and queue status", async () => {
    const session = sessionManager.createSession({
      title: "Test Infra Session",
      tenantId: "tenant-acme",
      namespace: "crucible-staging",
    });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/infra-status`,
      {
        method: "GET",
      },
    );

    const res = await handler.getInfraStatus(req, session.id);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.status).toBe("success");
    expect(json.sessionId).toBe(session.id);
    expect(json.data.kubernetes.tenantId).toBe("tenant-acme");
    expect(json.data.kubernetes.namespace).toBe("crucible-staging");
    expect(json.data.kubernetes.job?.jobName).toBe(`crucible-${session.id}`);
    expect(json.data.tenant.activeTenantId).toBe("tenant-acme");
    expect(json.data.tenant.activeNamespace).toBe("crucible-staging");
  });

  it("should calculate queue position and estimated wait when job is queued", async () => {
    const session = sessionManager.createSession({
      title: "Queued Session",
      tenantId: "tenant-beta",
      namespace: "crucible",
    });

    const scheduler = sessionManager.getJobScheduler();
    scheduler.stop(); // Stop worker dequeueing to preserve queued position
    await scheduler.enqueue({
      type: "session_run",
      sessionId: session.id,
      tenantId: "tenant-beta",
      namespace: "crucible",
      payload: { sessionId: session.id, prompt: "Queued test run" },
    });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/infra-status`,
      {
        method: "GET",
      },
    );

    const res = await handler.getInfraStatus(req, session.id);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.data.queue.position).toBeGreaterThanOrEqual(1);
    expect(json.data.queue.status).toBe("queued");
  });
});
