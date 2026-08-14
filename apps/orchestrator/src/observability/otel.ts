import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";

export type SpanKind =
  "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";
export type SpanStatus = "OK" | "ERROR" | "UNSET";

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: SpanStatus;
  errorMessage?: string;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export interface PerSessionMetrics {
  sessionId: string;
  traceCount: number;
  activeTraceCount: number;
  totalDurationMs: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  toolErrorRate: number;
  recentSpans: SpanData[];
}

export interface SystemMetricsSummary {
  timestamp: number;
  activeTraceCount: number;
  totalSpansRecorded: number;
  globalMeanLatencyMs: number;
  globalP95LatencyMs: number;
  globalToolCallsTotal: number;
  globalToolCallsFailed: number;
  globalToolErrorRate: number;
  sessionMetrics: Record<string, PerSessionMetrics>;
  recentTraces: SpanData[];
}

export function generateHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseTraceparent(
  header?: string,
): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  if (!header) return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00" || traceId.length !== 32 || spanId.length !== 16) {
    return null;
  }
  return {
    traceId,
    parentSpanId: spanId,
    sampled: flags === "01",
  };
}

export function formatTraceparent(
  traceId: string,
  spanId: string,
  sampled = true,
): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

export class Span {
  readonly id: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  endTime?: number;
  durationMs?: number;
  status: SpanStatus = "UNSET";
  errorMessage?: string;
  attributes: Record<string, unknown>;
  events: SpanEvent[] = [];

  constructor(
    name: string,
    options: {
      traceId?: string;
      parentSpanId?: string;
      kind?: SpanKind;
      attributes?: Record<string, unknown>;
    } = {},
  ) {
    this.name = name;
    this.id = generateHex(8);
    this.traceId = options.traceId || generateHex(16);
    this.parentSpanId = options.parentSpanId;
    this.kind = options.kind || "INTERNAL";
    this.startTime = performance.now();
    this.attributes = options.attributes ? { ...options.attributes } : {};
  }

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Record<string, unknown>): this {
    Object.assign(this.attributes, attributes);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({
      name,
      timestamp: performance.now(),
      attributes,
    });
    return this;
  }

  getTraceparent(): string {
    return formatTraceparent(this.traceId, this.id);
  }

  end(status: SpanStatus = "OK", errorMessage?: string): SpanData {
    if (this.endTime !== undefined) {
      return this.toJSON();
    }

    this.endTime = performance.now();
    this.durationMs = Math.round((this.endTime - this.startTime) * 100) / 100;
    this.status = status;
    this.errorMessage = errorMessage;

    const spanData = this.toJSON();
    spanCollector.recordSpan(spanData);
    return spanData;
  }

  toJSON(): SpanData {
    return {
      id: this.id,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.durationMs,
      status: this.status,
      errorMessage: this.errorMessage,
      attributes: { ...this.attributes },
      events: [...this.events],
    };
  }
}

class OpenTelemetryTracer {
  private storage = new AsyncLocalStorage<Span>();

  getActiveSpan(): Span | undefined {
    return this.storage.getStore();
  }

  getActiveTraceId(): string | undefined {
    return this.storage.getStore()?.traceId;
  }

  getActiveTraceparent(): string | undefined {
    const span = this.storage.getStore();
    return span ? span.getTraceparent() : undefined;
  }

  startSpan(
    name: string,
    options: {
      traceId?: string;
      parentSpanId?: string;
      traceparent?: string;
      kind?: SpanKind;
      attributes?: Record<string, unknown>;
    } = {},
  ): Span {
    const active = this.getActiveSpan();
    let traceId = options.traceId;
    let parentSpanId = options.parentSpanId;

    if (options.traceparent) {
      const parsed = parseTraceparent(options.traceparent);
      if (parsed) {
        traceId = parsed.traceId;
        parentSpanId = parsed.parentSpanId;
      }
    } else if (!traceId && active) {
      traceId = active.traceId;
      parentSpanId = active.id;
    }

    const attributes = {
      ...(active?.attributes?.sessionId
        ? { sessionId: active.attributes.sessionId }
        : {}),
      ...(options.attributes || {}),
    };

    return new Span(name, {
      traceId,
      parentSpanId,
      kind: options.kind,
      attributes,
    });
  }

  async withSpan<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: (span: Span) => Promise<T>,
    options: { kind?: SpanKind; traceparent?: string } = {},
  ): Promise<T> {
    const span = this.startSpan(name, {
      attributes,
      kind: options.kind,
      traceparent: options.traceparent,
    });

    spanCollector.trackActiveSpan(span);

    return this.storage.run(span, async () => {
      try {
        const result = await fn(span);
        span.end("OK");
        return result;
      } catch (err: any) {
        span.end("ERROR", err?.message || String(err));
        throw err;
      } finally {
        spanCollector.untrackActiveSpan(span.id);
      }
    });
  }
}

export const tracer = new OpenTelemetryTracer();

export class SpanCollector extends EventEmitter {
  private spans: SpanData[] = [];
  private activeSpans = new Map<string, Span>();
  private readonly maxStoredSpans = 5000;

  trackActiveSpan(span: Span): void {
    this.activeSpans.set(span.id, span);
    this.emit("activeSpanChanged", this.activeSpans.size);
  }

  untrackActiveSpan(spanId: string): void {
    this.activeSpans.delete(spanId);
    this.emit("activeSpanChanged", this.activeSpans.size);
  }

  recordSpan(span: SpanData): void {
    this.spans.push(span);
    if (this.spans.length > this.maxStoredSpans) {
      this.spans.splice(0, this.spans.length - this.maxStoredSpans);
    }
    this.emit("spanRecorded", span);
  }

  getActiveTraceCount(): number {
    return this.activeSpans.size;
  }

  getSpans(
    options: { sessionId?: string; traceId?: string; limit?: number } = {},
  ): SpanData[] {
    let result = this.spans;
    if (options.sessionId) {
      result = result.filter(
        (s) => s.attributes.sessionId === options.sessionId,
      );
    }
    if (options.traceId) {
      result = result.filter((s) => s.traceId === options.traceId);
    }
    const limit = options.limit || 100;
    return result.slice(-limit);
  }

  getPerSessionMetrics(
    targetSessionId?: string,
  ): Record<string, PerSessionMetrics> {
    const sessionMap = new Map<string, SpanData[]>();

    for (const span of this.spans) {
      const sessId = (span.attributes.sessionId as string) || "global";
      if (targetSessionId && sessId !== targetSessionId) continue;

      const list = sessionMap.get(sessId) || [];
      list.push(span);
      sessionMap.set(sessId, list);
    }

    const result: Record<string, PerSessionMetrics> = {};

    for (const [sessId, sessionSpans] of sessionMap.entries()) {
      const completed = sessionSpans.filter((s) => s.durationMs !== undefined);
      const durations = completed
        .map((s) => s.durationMs!)
        .sort((a, b) => a - b);
      const totalDur = durations.reduce((acc, d) => acc + d, 0);

      const toolSpans = sessionSpans.filter(
        (s) => s.name.startsWith("tool.") || s.attributes.toolName,
      );
      const failedTools = toolSpans.filter(
        (s) =>
          s.status === "ERROR" ||
          (s.attributes.exitCode && s.attributes.exitCode !== 0),
      );

      const toolErrorRate =
        toolSpans.length > 0
          ? Math.round((failedTools.length / toolSpans.length) * 10000) / 100
          : 0;

      const activeForSession = Array.from(this.activeSpans.values()).filter(
        (s) => s.attributes.sessionId === sessId,
      ).length;

      const p50 =
        durations.length > 0
          ? durations[Math.floor(durations.length * 0.5)]
          : 0;
      const p95 =
        durations.length > 0
          ? durations[Math.floor(durations.length * 0.95)]
          : 0;
      const p99 =
        durations.length > 0
          ? durations[Math.floor(durations.length * 0.99)]
          : 0;

      result[sessId] = {
        sessionId: sessId,
        traceCount: sessionSpans.length,
        activeTraceCount: activeForSession,
        totalDurationMs: Math.round(totalDur * 100) / 100,
        meanLatencyMs:
          durations.length > 0
            ? Math.round((totalDur / durations.length) * 100) / 100
            : 0,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        minLatencyMs: durations.length > 0 ? durations[0] : 0,
        maxLatencyMs:
          durations.length > 0 ? durations[durations.length - 1] : 0,
        toolCallsTotal: toolSpans.length,
        toolCallsFailed: failedTools.length,
        toolErrorRate,
        recentSpans: sessionSpans.slice(-20),
      };
    }

    return result;
  }

  getSystemSummary(sessionId?: string): SystemMetricsSummary {
    const sessionMetrics = this.getPerSessionMetrics(sessionId);
    const spans = sessionId
      ? this.spans.filter((s) => s.attributes.sessionId === sessionId)
      : this.spans;

    const completed = spans.filter((s) => s.durationMs !== undefined);
    const durations = completed.map((s) => s.durationMs!).sort((a, b) => a - b);
    const totalDur = durations.reduce((acc, d) => acc + d, 0);

    const toolSpans = spans.filter(
      (s) => s.name.startsWith("tool.") || s.attributes.toolName,
    );
    const failedTools = toolSpans.filter(
      (s) =>
        s.status === "ERROR" ||
        (s.attributes.exitCode && s.attributes.exitCode !== 0),
    );

    const globalToolErrorRate =
      toolSpans.length > 0
        ? Math.round((failedTools.length / toolSpans.length) * 10000) / 100
        : 0;

    const p95 =
      durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;

    return {
      timestamp: Date.now(),
      activeTraceCount: this.activeSpans.size,
      totalSpansRecorded: this.spans.length,
      globalMeanLatencyMs:
        durations.length > 0
          ? Math.round((totalDur / durations.length) * 100) / 100
          : 0,
      globalP95LatencyMs: p95,
      globalToolCallsTotal: toolSpans.length,
      globalToolCallsFailed: failedTools.length,
      globalToolErrorRate,
      sessionMetrics,
      recentTraces: this.spans.slice(-30),
    };
  }

  clear(): void {
    this.spans = [];
    this.activeSpans.clear();
  }
}

export const spanCollector = new SpanCollector();
