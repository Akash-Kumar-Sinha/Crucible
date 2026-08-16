import { getPreviewManager } from "./preview-manager";
import { logger } from "../observability/logger";

/**
 * Proxy Pattern: Reverse proxy for browser requests into the sandbox's exposed port.
 * Keeps the sandbox unreachable from outside while enabling live interactive preview.
 */
export class PreviewProxyHandler {
  async handleProxyRequest(
    req: Request,
    sessionId: string,
    subpath: string,
  ): Promise<Response> {
    const previewManager = getPreviewManager();
    const preview = previewManager.getPreview(sessionId);

    if (!preview || preview.status !== "ready") {
      // If preview server is not running or crashed, return formatted status page
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Preview Unavailable</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #09090b; color: #a1a1aa; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 24px; text-align: center; }
    .card { background: #18181b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 32px; max-width: 480px; }
    h1 { color: #f43f5e; font-size: 16px; margin: 0 0 12px 0; }
    p { font-size: 13px; line-height: 1.5; margin: 0 0 16px 0; }
    .badge { display: inline-block; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.3); color: #fda4af; padding: 4px 8px; border-radius: 6px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Sandbox Preview Status: ${preview?.status || "offline"}</div>
    <h1 style="margin-top: 16px;">Preview Server Offline</h1>
    <p>No active dev server detected in this sandbox session. Generate or run a frontend application in the chat to spin up a live preview.</p>
  </div>
</body>
</html>`,
        {
          status: preview?.status === "crashed" ? 502 : 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Content-Security-Policy":
              "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;",
          },
        },
      );
    }

    const cleanSubpath = subpath
      ? subpath.startsWith("/")
        ? subpath
        : `/${subpath}`
      : "/";

    const targetUrl = `http://127.0.0.1:${preview.port}${cleanSubpath}`;

    try {
      // Forward HTTP request to sandbox dev server
      const url = new URL(req.url);
      const queryString = url.search;
      const fullTarget = `${targetUrl}${queryString}`;

      const forwardHeaders = new Headers(req.headers);
      forwardHeaders.set("Host", `127.0.0.1:${preview.port}`);
      forwardHeaders.delete("connection");

      const fetchOptions: RequestInit = {
        method: req.method,
        headers: forwardHeaders,
        redirect: "manual",
      };

      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        fetchOptions.body = req.body;
      }

      const upstreamRes = await fetch(fullTarget, fetchOptions);

      // Construct downstream response with enhanced security headers
      const responseHeaders = new Headers(upstreamRes.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set(
        "Content-Security-Policy",
        "frame-ancestors 'self' http://localhost:* https://localhost:*;",
      );
      responseHeaders.set("X-Content-Type-Options", "nosniff");

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: responseHeaders,
      });
    } catch (err: any) {
      // If live proxy fails but session has static HTML component registered, fallback to it
      if (preview.staticHtml) {
        return new Response(preview.staticHtml, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Content-Security-Policy":
              "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; frame-ancestors 'self' http://localhost:* https://localhost:*;",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      logger.error(
        { err, sessionId, targetUrl },
        `[PreviewProxy] Failed to connect to sandbox dev server on port ${preview.port}`,
      );

      previewManager.recordCrash(
        sessionId,
        `Sandbox dev server connection refused on port ${preview.port}: ${err?.message}`,
      );

      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Preview Connection Refused</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #09090b; color: #a1a1aa; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 24px; text-align: center; }
    .card { background: #18181b; border: 1px solid rgba(244,63,94,0.3); border-radius: 12px; padding: 32px; max-width: 480px; }
    h1 { color: #f43f5e; font-size: 16px; margin: 0 0 12px 0; }
    p { font-size: 13px; line-height: 1.5; margin: 0 0 16px 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Preview Server Connection Refused</h1>
    <p>The dev server inside the sandbox did not respond on port ${preview.port}. It may still be booting or crashed during startup.</p>
  </div>
</body>
</html>`,
        {
          status: 502,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  }

  async handleGetStatus(sessionId: string): Promise<Response> {
    const previewManager = getPreviewManager();
    const preview = previewManager.getPreview(sessionId);

    return Response.json({
      status: "success",
      active: !!preview && preview.status === "ready",
      preview: preview || null,
    });
  }

  async handleStart(req: Request, sessionId: string): Promise<Response> {
    try {
      const body = await req.json().catch(() => ({}));
      const previewManager = getPreviewManager();
      const info = previewManager.startPreview(sessionId, body);

      return Response.json({
        status: "success",
        message: "Sandbox preview server registered",
        preview: info,
      });
    } catch (err: any) {
      return Response.json(
        {
          status: "error",
          error: {
            code: "PREVIEW_START_ERROR",
            message: err?.message || "Failed to start preview",
          },
        },
        { status: 500 },
      );
    }
  }

  async handleStop(sessionId: string): Promise<Response> {
    const previewManager = getPreviewManager();
    const stopped = previewManager.stopPreview(sessionId);

    return Response.json({
      status: "success",
      stopped,
    });
  }
}
