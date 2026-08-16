import { describe, it, expect, beforeEach } from "bun:test";
import { getPreviewManager, resetPreviewManager } from "./preview-manager";
import { PreviewProxyHandler } from "./preview-proxy";

describe("Live Sandbox Preview Subsystem", () => {
  let proxyHandler: PreviewProxyHandler;

  beforeEach(() => {
    resetPreviewManager();
    proxyHandler = new PreviewProxyHandler();
  });

  it("should register and retrieve a sandboxed preview server", () => {
    const manager = getPreviewManager();
    const info = manager.startPreview("sess_preview_1", {
      port: 5173,
      framework: "vite",
    });

    expect(info.sessionId).toBe("sess_preview_1");
    expect(info.port).toBe(5173);
    expect(info.status).toBe("ready");
    expect(info.targetUrl).toBe("http://127.0.0.1:5173");

    const retrieved = manager.getPreview("sess_preview_1");
    expect(retrieved?.status).toBe("ready");
  });

  it("should stop and clean up an active preview server", () => {
    const manager = getPreviewManager();
    manager.startPreview("sess_preview_2", { port: 3000 });

    const stopped = manager.stopPreview("sess_preview_2");
    expect(stopped).toBe(true);
    expect(manager.getPreview("sess_preview_2")).toBeUndefined();
  });

  it("should record crash and update server status", () => {
    const manager = getPreviewManager();
    manager.startPreview("sess_preview_3", { port: 8080 });

    manager.recordCrash(
      "sess_preview_3",
      "Vite out-of-memory error in sandbox",
    );
    const preview = manager.getPreview("sess_preview_3");
    expect(preview?.status).toBe("crashed");
    expect(preview?.error).toContain("out-of-memory");
  });

  it("should return formatted offline page when proxying to non-existent preview", async () => {
    const req = new Request(
      "http://localhost:4000/preview/sess_none/index.html",
    );
    const res = await proxyHandler.handleProxyRequest(
      req,
      "sess_none",
      "/index.html",
    );

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Preview Server Offline");
  });

  it("should return status via handleGetStatus", async () => {
    const manager = getPreviewManager();
    manager.startPreview("sess_preview_4", { port: 5173 });

    const res = await proxyHandler.handleGetStatus("sess_preview_4");
    const json = await res.json();

    expect(json.status).toBe("success");
    expect(json.active).toBe(true);
    expect(json.preview.port).toBe(5173);
  });

  it("should serve static HTML and reflect dynamic setPreviewContent updates", async () => {
    const manager = getPreviewManager();
    manager.setPreviewContent(
      "sess_preview_5",
      "<!DOCTYPE html><html><body><h1 id='comp'>Dynamic Component v1</h1></body></html>",
    );

    const req = new Request(
      "http://localhost:4000/preview/sess_preview_5/index.html",
    );
    const res1 = await proxyHandler.handleProxyRequest(
      req,
      "sess_preview_5",
      "/index.html",
    );

    expect(res1.status).toBe(200);
    const html1 = await res1.text();
    expect(html1).toContain("Dynamic Component v1");

    // Dynamically regenerate / update component
    manager.setPreviewContent(
      "sess_preview_5",
      "<!DOCTYPE html><html><body><h1 id='comp'>Dynamic Component v2 (Regenerated)</h1></body></html>",
    );

    const res2 = await proxyHandler.handleProxyRequest(
      req,
      "sess_preview_5",
      "/index.html",
    );

    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain("Dynamic Component v2 (Regenerated)");
  });
});
