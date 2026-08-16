import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHttpRouter } from "../http/server";
import { SessionManager } from "../session/session-manager";
import { getPreviewManager, resetPreviewManager } from "./preview-manager";

describe("Live Sandbox Preview E2E & Isolation Verification", () => {
  let sessionManager: SessionManager;
  let server: any;
  let devServer: any;
  let devPort: number;
  let currentComponentHtml: string;

  beforeEach(async () => {
    resetPreviewManager();
    sessionManager = new SessionManager({});

    // Spin up an isolated mock Vite/HTML dev server on loopback 127.0.0.1
    currentComponentHtml = `<!DOCTYPE html>
<html>
<head><title>Crucible Component</title></head>
<body>
  <div id="root">
    <button id="preview-btn" style="background:#0284c7;color:#fff;padding:8px 16px;border-radius:8px;">
      Crucible Live Button
    </button>
  </div>
</body>
</html>`;

    devServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0, // Ephemeral port
      fetch(_req) {
        return new Response(currentComponentHtml, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      },
    });
    devPort = devServer.port;

    const router = createHttpRouter(sessionManager);
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: router,
    });
  });

  afterEach(() => {
    if (devServer) devServer.stop();
    if (server) server.stop();
    resetPreviewManager();
  });

  it("should create a Coder session, proxy its sandboxed dev server, and render live preview", async () => {
    // 1. Create a Coder session
    const session = await sessionManager.createSession({
      title: "UI Component Builder",
      role: "coder",
    });
    expect(session.id).toBeDefined();

    // 2. Start preview server in PreviewManager pointing at the sandbox loopback port
    const previewManager = getPreviewManager();
    const info = previewManager.startPreview(session.id, {
      port: devPort,
      framework: "vite",
    });

    expect(info.status).toBe("ready");
    expect(info.port).toBe(devPort);

    // 3. Request through Orchestrator reverse proxy (GET /preview/:sessionId/index.html)
    const proxyUrl = `http://127.0.0.1:${server.port}/preview/${session.id}/index.html`;
    const res = await fetch(proxyUrl);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const html = await res.text();
    expect(html).toContain("Crucible Live Button");
    expect(html).toContain('id="preview-btn"');

    // 4. Edit / regenerate the component in the sandbox
    currentComponentHtml = `<!DOCTYPE html>
<html>
<head><title>Crucible Component</title></head>
<body>
  <div id="root">
    <button id="preview-btn" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;font-weight:bold;">
      Updated Button v2 (Live Reloaded)
    </button>
  </div>
</body>
</html>`;

    // 5. Re-query proxy URL to confirm live reflection
    const updateRes = await fetch(proxyUrl);
    expect(updateRes.status).toBe(200);
    const updatedHtml = await updateRes.text();
    expect(updatedHtml).toContain("Updated Button v2 (Live Reloaded)");
    expect(updatedHtml).toContain("background:#10b981");

    // 6. Verify status endpoint (GET /preview/:sessionId/status)
    const statusRes = await fetch(
      `http://127.0.0.1:${server.port}/preview/${session.id}/status`,
    );
    const statusJson = await statusRes.json();
    expect(statusJson.status).toBe("success");
    expect(statusJson.active).toBe(true);
    expect(statusJson.preview.port).toBe(devPort);

    // 7. Verify teardown
    previewManager.stopPreview(session.id);
    const offlineRes = await fetch(proxyUrl);
    expect(offlineRes.status).toBe(404);
    const offlineHtml = await offlineRes.text();
    expect(offlineHtml).toContain("Preview Server Offline");
  });
});
