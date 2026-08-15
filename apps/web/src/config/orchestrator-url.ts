export function getOrchestratorUrl(): string {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
  ) {
    return process.env.NEXT_PUBLIC_ORCHESTRATOR_URL.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    // When behind an Ingress / Service proxy sharing the origin
    if (window.location.port === "3000" || !window.location.port) {
      return window.location.origin.replace(/:3000$/, ":4000");
    }
    return window.location.origin;
  }

  return "http://localhost:4000";
}

export function getStreamUrl(sessionId?: string): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STREAM_URL) {
    const baseStream = process.env.NEXT_PUBLIC_STREAM_URL.replace(/\/$/, "");
    return sessionId ? `${baseStream}/${sessionId}/stream` : baseStream;
  }

  const base = getOrchestratorUrl();
  return sessionId
    ? `${base}/api/sessions/${sessionId}/stream`
    : `${base}/api/sessions`;
}

export function getWsUrl(sessionId?: string): string {
  const httpUrl = getOrchestratorUrl();
  const wsBase = httpUrl.replace(/^http/, "ws");
  return sessionId ? `${wsBase}/ws?sessionId=${sessionId}` : `${wsBase}/ws`;
}
