export interface ClientErrorContext {
  sessionId?: string;
  component?: string;
  route?: string;
  action?: string;
  extra?: Record<string, unknown>;
}

export interface ClientCapturedError {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  componentStack?: string;
  context: ClientErrorContext;
}

export function captureClientError(
  error: unknown,
  context: ClientErrorContext = {},
): string {
  const errorId = `web_err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const timestamp = new Date().toISOString();

  let message = "Unknown web client error";
  let stack: string | undefined;

  if (error instanceof Error) {
    message = error.message;
    stack = error.stack;
  } else if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && error !== null) {
    const maybeObj = error as Record<string, unknown>;
    message =
      typeof maybeObj.message === "string"
        ? maybeObj.message
        : JSON.stringify(error);
    if (typeof maybeObj.stack === "string") {
      stack = maybeObj.stack;
    }
  }

  const record: ClientCapturedError = {
    id: errorId,
    timestamp,
    message,
    stack,
    context,
  };

  // Structured client logging
  if (process.env.NODE_ENV !== "production") {
    console.error(`[Crucible Web Error] ${record.id}:`, message, {
      context,
      stack,
    });
  }

  // GlitchTip / Sentry-compatible DSN HTTP reporting if configured
  const dsn =
    typeof window !== "undefined"
      ? (window as any).__NEXT_DATA__?.runtimeConfig
          ?.NEXT_PUBLIC_GLITCHTIP_DSN ||
        (window as any).__NEXT_DATA__?.runtimeConfig
          ?.NEXT_PUBLIC_ERROR_TRACKING_DSN ||
        process.env.NEXT_PUBLIC_GLITCHTIP_DSN ||
        process.env.NEXT_PUBLIC_ERROR_TRACKING_DSN ||
        process.env.NEXT_PUBLIC_SENTRY_DSN
      : process.env.GLITCHTIP_DSN ||
        process.env.ERROR_TRACKING_DSN ||
        process.env.SENTRY_DSN;

  if (dsn && typeof fetch !== "undefined") {
    try {
      const url = new URL(dsn);
      const publicKey = url.username;
      const host = url.host;
      const projectId = url.pathname.replace(/^\//, "");
      const storeUrl = `${url.protocol}//${host}/api/${projectId}/store/`;

      const payload = {
        event_id: errorId
          .replace(/^web_err_/, "")
          .padEnd(32, "0")
          .substring(0, 32),
        timestamp,
        platform: "javascript",
        sdk: { name: "crucible.web", version: "0.1.0" },
        level: "error",
        message,
        tags: {
          environment: process.env.NODE_ENV || "development",
          component: context.component || "unknown",
          session_id: context.sessionId || "none",
        },
        extra: {
          ...context.extra,
          route: context.route,
          action: context.action,
        },
        exception: {
          values: [
            {
              type: "Error",
              value: message,
              stacktrace: stack
                ? {
                    frames: stack
                      .split("\n")
                      .slice(1)
                      .map((line) => ({ filename: line.trim() })),
                  }
                : undefined,
            },
          ],
        },
      };

      fetch(storeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=crucible-web/0.1.0, sentry_key=${publicKey}`,
        },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Discard background network transport errors
      });
    } catch {
      // Discard URL parse errors
    }
  }

  return errorId;
}
