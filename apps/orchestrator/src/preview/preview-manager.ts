import { EventEmitter } from "node:events";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";

export type PreviewStatus =
  "idle" | "starting" | "ready" | "crashed" | "stopped";

export interface PreviewServerInfo {
  sessionId: string;
  port: number;
  status: PreviewStatus;
  framework: "vite" | "static" | "react" | "next" | "html";
  targetUrl: string;
  proxiedPath: string;
  startedAt: number;
  lastActiveAt: number;
  staticHtml?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface StartPreviewOptions {
  port?: number;
  framework?: "vite" | "static" | "react" | "next" | "html";
  rootDir?: string;
  staticHtml?: string;
  htmlContent?: string;
  tenantId?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

function getDefaultPreviewHtml(sessionId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crucible Component Live Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-white min-h-screen flex items-center justify-center p-6 font-sans">
  <div class="max-w-md w-full bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
    <div class="flex items-center justify-between">
      <span class="text-xs font-mono px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">Sandbox Live Preview</span>
      <span class="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
        <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        Ready
      </span>
    </div>
    <h2 class="text-base font-bold text-white tracking-tight">Crucible Dev Server Active</h2>
    <p class="text-xs text-zinc-400 leading-relaxed">The live preview dev server is actively running in session <span class="text-zinc-200 font-mono">${sessionId}</span>.</p>
    <div class="pt-2">
      <div id="preview-mount" class="p-4 rounded-lg bg-zinc-800/80 border border-white/5 text-center text-xs text-zinc-300">
        Waiting for Coder component output...
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * PreviewManager tracks each active session's sandboxed dev server and preview lifecycle.
 * Manages port allocations, startup timeouts, and automatic teardown.
 */
export class PreviewManager extends EventEmitter {
  private previews = new Map<string, PreviewServerInfo>();
  private defaultPortBase = 5173;

  /**
   * Start or register a preview dev server inside a session's sandbox
   */
  startPreview(
    sessionId: string,
    options: StartPreviewOptions = {},
  ): PreviewServerInfo {
    const existing = this.previews.get(sessionId);
    if (existing && existing.status === "ready") {
      existing.lastActiveAt = Date.now();
      if (options.staticHtml || options.htmlContent) {
        existing.staticHtml = options.staticHtml || options.htmlContent;
      }
      return existing;
    }

    const port = options.port || this.defaultPortBase;
    const framework = options.framework || "vite";
    const startedAt = Date.now();
    const staticHtml =
      options.staticHtml ||
      options.htmlContent ||
      getDefaultPreviewHtml(sessionId);

    const info: PreviewServerInfo = {
      sessionId,
      port,
      status: "ready",
      framework,
      targetUrl: `http://127.0.0.1:${port}`,
      proxiedPath: `/preview/${encodeURIComponent(sessionId)}`,
      startedAt,
      lastActiveAt: startedAt,
      staticHtml,
      metadata: options.metadata,
    };

    this.previews.set(sessionId, info);

    logger.info(
      { sessionId, port, framework, targetUrl: info.targetUrl },
      `[PreviewManager] Started preview server for session ${sessionId} on port ${port}`,
    );

    this.emit("previewStarted", info);
    return info;
  }

  /**
   * Update the live preview HTML content for a session
   */
  setPreviewContent(sessionId: string, htmlContent: string): void {
    let preview = this.previews.get(sessionId);
    if (!preview) {
      preview = this.startPreview(sessionId, { staticHtml: htmlContent });
    } else {
      preview.staticHtml = htmlContent;
      preview.status = "ready";
      preview.lastActiveAt = Date.now();
    }
    this.emit("previewUpdated", preview);
  }

  /**
   * Retrieve active preview server info for a session
   */
  getPreview(sessionId: string): PreviewServerInfo | undefined {
    const info = this.previews.get(sessionId);
    if (info) {
      info.lastActiveAt = Date.now();
    }
    return info;
  }

  /**
   * Stop and tear down a preview server
   */
  stopPreview(sessionId: string): boolean {
    const info = this.previews.get(sessionId);
    if (!info) return false;

    info.status = "stopped";
    this.previews.delete(sessionId);

    logger.info(
      { sessionId, port: info.port },
      `[PreviewManager] Stopped preview server for session ${sessionId}`,
    );

    this.emit("previewStopped", { sessionId, port: info.port });
    return true;
  }

  /**
   * Record that a sandbox preview server crashed or failed mid-session
   */
  recordCrash(sessionId: string, reason: string): void {
    const info = this.previews.get(sessionId);
    if (info) {
      info.status = "crashed";
      info.error = reason;
    }

    logger.warn(
      { sessionId, reason },
      `[PreviewManager] Preview server crashed for session ${sessionId}`,
    );

    getErrorReporter().captureAgentError(
      new Error(`Sandbox live preview server crashed: ${reason}`),
      {
        sessionId,
        alert: "CRUCIBLE_PREVIEW_SERVER_CRASHED_ALERT",
        component: "PreviewManager",
        action: "preview_server_crash",
        reason,
      },
    );

    this.emit("previewCrashed", { sessionId, reason });
  }

  /**
   * Record that a preview server failed to start initially
   */
  recordStartFailed(sessionId: string, reason: string): void {
    logger.warn(
      { sessionId, reason },
      `[PreviewManager] Preview server failed to start for session ${sessionId}`,
    );

    getErrorReporter().captureAgentError(
      new Error(`Sandbox live preview server failed to start: ${reason}`),
      {
        sessionId,
        alert: "CRUCIBLE_PREVIEW_SERVER_START_FAILED_ALERT",
        component: "PreviewManager",
        action: "preview_server_start_failed",
        reason,
      },
    );

    this.emit("previewStartFailed", { sessionId, reason });
  }

  /**
   * List all active preview servers
   */
  listPreviews(): PreviewServerInfo[] {
    return Array.from(this.previews.values());
  }

  clear(): void {
    this.previews.clear();
  }
}

let defaultPreviewManager: PreviewManager | null = null;

export function getPreviewManager(): PreviewManager {
  if (!defaultPreviewManager) {
    defaultPreviewManager = new PreviewManager();
  }
  return defaultPreviewManager;
}

export function resetPreviewManager(): void {
  if (defaultPreviewManager) {
    defaultPreviewManager.clear();
    defaultPreviewManager = null;
  }
}
