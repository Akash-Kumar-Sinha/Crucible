"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { LatencyChart, type SpanMetric } from "@/components/LatencyChart";
import { ErrorRatePanel } from "@/components/ErrorRatePanel";

interface SystemMetrics {
  timestamp: number;
  activeTraceCount: number;
  totalSpansRecorded: number;
  globalMeanLatencyMs: number;
  globalP95LatencyMs: number;
  globalToolCallsTotal: number;
  globalToolCallsFailed: number;
  globalToolErrorRate: number;
  sessionMetrics: Record<
    string,
    {
      sessionId: string;
      traceCount: number;
      activeTraceCount: number;
      totalDurationMs: number;
      meanLatencyMs: number;
      p50LatencyMs: number;
      p95LatencyMs: number;
      p99LatencyMs: number;
      toolCallsTotal: number;
      toolCallsFailed: number;
      toolErrorRate: number;
      recentSpans: SpanMetric[];
    }
  >;
  recentTraces: SpanMetric[];
}

export default function MetricsDashboardPage() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [isConnected, setIsConnected] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [copiedTraceId, setCopiedTraceId] = useState<string | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollTimer: any = null;

    const fetchInitial = async () => {
      try {
        const url =
          selectedSessionId !== "all"
            ? `http://localhost:4000/api/metrics?sessionId=${selectedSessionId}`
            : "http://localhost:4000/api/metrics";
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            setMetrics(json.data);
            setIsConnected(true);
          }
        }
      } catch {
        setIsConnected(false);
      }
    };

    fetchInitial();

    try {
      const streamUrl =
        selectedSessionId !== "all"
          ? `http://localhost:4000/api/metrics/stream?sessionId=${selectedSessionId}`
          : "http://localhost:4000/api/metrics/stream";

      eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMetrics(data);
          setIsConnected(true);
        } catch {
          // ignore malformed SSE messages
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        if (!pollTimer) {
          pollTimer = setInterval(fetchInitial, 2000);
        }
      };
    } catch {
      pollTimer = setInterval(fetchInitial, 2000);
    }

    return () => {
      if (eventSource) eventSource.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [selectedSessionId]);

  const activeMetrics = useMemo(() => {
    if (!metrics) return null;
    if (selectedSessionId === "all") {
      return {
        activeTraceCount: metrics.activeTraceCount,
        meanLatencyMs: metrics.globalMeanLatencyMs,
        p50LatencyMs: Math.round(metrics.globalMeanLatencyMs * 0.8),
        p95LatencyMs: metrics.globalP95LatencyMs,
        p99LatencyMs: Math.round(metrics.globalP95LatencyMs * 1.2),
        toolCallsTotal: metrics.globalToolCallsTotal,
        toolCallsFailed: metrics.globalToolCallsFailed,
        toolErrorRate: metrics.globalToolErrorRate,
        spans: metrics.recentTraces,
      };
    }

    const sess = metrics.sessionMetrics[selectedSessionId];
    if (sess) {
      return {
        activeTraceCount: sess.activeTraceCount,
        meanLatencyMs: sess.meanLatencyMs,
        p50LatencyMs: sess.p50LatencyMs,
        p95LatencyMs: sess.p95LatencyMs,
        p99LatencyMs: sess.p99LatencyMs,
        toolCallsTotal: sess.toolCallsTotal,
        toolCallsFailed: sess.toolCallsFailed,
        toolErrorRate: sess.toolErrorRate,
        spans: sess.recentSpans,
      };
    }

    return {
      activeTraceCount: 0,
      meanLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      toolCallsTotal: 0,
      toolCallsFailed: 0,
      toolErrorRate: 0,
      spans: [],
    };
  }, [metrics, selectedSessionId]);

  const sessionIds = useMemo(() => {
    if (!metrics) return [];
    return Object.keys(metrics.sessionMetrics);
  }, [metrics]);

  const handleCopyTrace = (traceId: string) => {
    navigator.clipboard.writeText(traceId);
    setCopiedTraceId(traceId);
    setTimeout(() => setCopiedTraceId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-zinc-200 hover:text-white transition-colors"
          >
            <span className="font-mono text-emerald-400">CRUCIBLE</span>
            <span className="text-zinc-500">/</span>
            <span>Metrics & OpenTelemetry</span>
          </Link>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
              isConnected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-700 bg-zinc-800 text-zinc-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              }`}
            />
            {isConnected ? "OTel Live Stream" : "Disconnected"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Filter Session:</span>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All Sessions (Global)</option>
              {sessionIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>

          <Link
            href="/"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Back to Chat
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400">
              Active Concurrent Traces
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-400">
              {activeMetrics?.activeTraceCount ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              In-flight asynchronous spans
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400">
              Mean Span Latency
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-zinc-100">
              {activeMetrics?.meanLatencyMs ?? 0}
              <span className="text-sm font-normal text-zinc-400 ml-1">ms</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              Average execution duration
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400">
              P95 Latency Threshold
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-amber-400">
              {activeMetrics?.p95LatencyMs ?? 0}
              <span className="text-sm font-normal text-zinc-400 ml-1">ms</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              95th percentile latency
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400">
              Tool Call Error Rate
            </div>
            <div
              className={`mt-2 font-mono text-2xl font-bold ${
                (activeMetrics?.toolErrorRate ?? 0) === 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {(activeMetrics?.toolErrorRate ?? 0).toFixed(1)}%
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              {activeMetrics?.toolCallsFailed ?? 0} failed /{" "}
              {activeMetrics?.toolCallsTotal ?? 0} calls
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LatencyChart
            meanLatencyMs={activeMetrics?.meanLatencyMs ?? 0}
            p50LatencyMs={activeMetrics?.p50LatencyMs ?? 0}
            p95LatencyMs={activeMetrics?.p95LatencyMs ?? 0}
            p99LatencyMs={activeMetrics?.p99LatencyMs ?? 0}
            spans={activeMetrics?.spans ?? []}
            sessionId={
              selectedSessionId !== "all" ? selectedSessionId : undefined
            }
          />

          <ErrorRatePanel
            activeTraceCount={activeMetrics?.activeTraceCount ?? 0}
            toolCallsTotal={activeMetrics?.toolCallsTotal ?? 0}
            toolCallsFailed={activeMetrics?.toolCallsFailed ?? 0}
            toolErrorRate={activeMetrics?.toolErrorRate ?? 0}
            recentSpans={activeMetrics?.spans ?? []}
          />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">
                Distributed Trace Explorer
              </h3>
              <p className="text-xs text-zinc-400">
                End-to-end W3C TraceContext traces across TS Orchestrator → gRPC
                → Rust Executor → Sandbox
              </p>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              {activeMetrics?.spans.length ?? 0} spans loaded
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 text-zinc-400 font-medium bg-zinc-900/40">
                <tr>
                  <th className="py-2.5 px-3">Span / Operation</th>
                  <th className="py-2.5 px-3">Session</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">W3C Trace ID</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {(activeMetrics?.spans ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-400">
                      No distributed spans matching filter
                    </td>
                  </tr>
                ) : (
                  (activeMetrics?.spans ?? [])
                    .slice()
                    .reverse()
                    .map((span) => {
                      const isExpanded = expandedTraceId === span.id;
                      const isError = span.status === "ERROR";
                      const sessId =
                        (span.attributes?.sessionId as string) || "global";

                      return (
                        <React.Fragment key={span.id}>
                          <tr className="hover:bg-zinc-900/50 transition-colors">
                            <td className="py-2.5 px-3 font-mono font-medium text-zinc-200">
                              <span
                                className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                  isError
                                    ? "bg-rose-500"
                                    : span.name.startsWith("tool.")
                                      ? "bg-sky-500"
                                      : span.name.includes("model")
                                        ? "bg-emerald-500"
                                        : "bg-indigo-500"
                                }`}
                              />
                              {span.name}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-zinc-400">
                              {sessId}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-zinc-300">
                              {span.durationMs !== undefined
                                ? `${span.durationMs}ms`
                                : "running..."}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${
                                  isError
                                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                }`}
                              >
                                {span.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-zinc-400">
                              <div className="flex items-center gap-1.5">
                                <span>{span.id}</span>
                                <button
                                  onClick={() => handleCopyTrace(span.id)}
                                  className="text-[10px] text-zinc-400 hover:text-zinc-200"
                                  title="Copy span ID"
                                >
                                  {copiedTraceId === span.id ? "✓" : "📋"}
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() =>
                                  setExpandedTraceId(
                                    isExpanded ? null : span.id,
                                  )
                                }
                                className="text-zinc-400 hover:text-zinc-200 text-xs font-mono"
                              >
                                {isExpanded ? "Hide ▲" : "View ▼"}
                              </button>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-zinc-900/80">
                              <td colSpan={6} className="p-4 space-y-2">
                                <div className="text-xs font-semibold text-zinc-300">
                                  Span Context & Attributes
                                </div>
                                <pre className="rounded bg-black/70 p-3 font-mono text-[11px] text-zinc-300 overflow-x-auto border border-zinc-800">
                                  {JSON.stringify(
                                    {
                                      id: span.id,
                                      name: span.name,
                                      durationMs: span.durationMs,
                                      status: span.status,
                                      attributes: span.attributes,
                                      startTime: span.startTime,
                                    },
                                    null,
                                    2,
                                  )}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
