"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Clock,
  Copy,
  Check,
  Layers,
  Shield,
  Terminal,
  Zap,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  LatencyChart,
  type SpanMetric,
} from "@/components/metrics/LatencyChart";
import { ErrorRatePanel } from "@/components/metrics/ErrorRatePanel";
import {
  TokenUsagePanel,
  type TokenUsageMetric,
} from "@/components/metrics/TokenUsagePanel";
import {
  ModelUsagePanel,
  type ModelUsageMetric,
} from "@/components/metrics/ModelUsagePanel";
import {
  RoleActivityPanel,
  type RoleActivityMetric,
  type CrossSessionMetrics,
} from "@/components/metrics/RoleActivityPanel";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProximityGlowCard } from "@/components/ui/proximity-glow";
import { cn } from "@/lib/utils";
import { getOrchestratorUrl } from "@/config/orchestrator-url";

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
  tokenMetrics?: {
    totalTokensConsumed: number;
    perSessionTokens: TokenUsageMetric[];
    summarizedSessionsCount: number;
  };
  modelMetrics?: {
    totalRequests: number;
    models: Record<string, ModelUsageMetric>;
  };
  roleMetrics?: {
    roles: Record<string, RoleActivityMetric>;
  };
  crossSessionMetrics?: CrossSessionMetrics;
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
        const baseUrl = getOrchestratorUrl();
        const url =
          selectedSessionId !== "all"
            ? `${baseUrl}/api/metrics?sessionId=${selectedSessionId}`
            : `${baseUrl}/api/metrics`;
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
      const baseUrl = getOrchestratorUrl();
      const streamUrl =
        selectedSessionId !== "all"
          ? `${baseUrl}/api/metrics/stream?sessionId=${selectedSessionId}`
          : `${baseUrl}/api/metrics/stream`;

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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 ">
      {/* Sticky Premium Header */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/8 bg-zinc-950/80 px-6 sm:px-8 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-3 text-sm font-semibold text-zinc-200 transition-colors hover:text-white group"
          >
            <Logo className="w-7 h-7 text-white transition-transform group-hover:scale-105" />
            <CrucibleWordmark className="text-2xl text-white transition-colors leading-none" />
            <span className="text-zinc-700 font-light hidden sm:inline">/</span>
            <span className="text-xs uppercase tracking-wider text-zinc-400 font-medium hidden sm:inline">
              Telemetry & Traces
            </span>
          </Link>

          <div
            className={cn(
              "hidden md:inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-medium transition-colors font-mono",
              isConnected
                ? "border-emerald-500/20 bg-emerald-950/20 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500",
            )}
          >
            <span className="relative flex h-2 w-2">
              {isConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  isConnected ? "bg-emerald-400" : "bg-zinc-600",
                )}
              />
            </span>
            <span>{isConnected ? "W3C Live Stream" : "Offline"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/60 px-3 py-1.5 backdrop-blur-md hover:border-white/20 transition-all text-xs font-mono">
            <Filter size={13} className="text-zinc-400" />
            <span className="text-zinc-500 hidden md:inline">Scope:</span>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="bg-transparent text-xs text-zinc-200 outline-none cursor-pointer pr-1"
            >
              <option value="all" className="bg-zinc-900 text-zinc-100">
                All Sessions (Global)
              </option>
              {sessionIds.map((id) => (
                <option
                  key={id}
                  value={id}
                  className="bg-zinc-900 text-zinc-100"
                >
                  {id}
                </option>
              ))}
            </select>
          </div>

          <Link href="/workspace">
            <Button size="sm" className="gap-1.5">
              <span>Open Workspace</span>
            </Button>
          </Link>

          <Link href="/">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-white/10 bg-zinc-900/40 hover:bg-zinc-800 text-zinc-300"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">Home</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 sm:p-8 space-y-8">
        {/* KPI Highlight Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ProximityGlowCard
            radius={240}
            intensity={0.9}
            className="border border-white/8 bg-zinc-900/60"
            title="Active Traces"
            subtitle="In-flight asynchronous spans"
          >
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/10 text-zinc-200">
                  <Activity size={18} />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold px-2 py-0.5 rounded-lg bg-zinc-800/60 border border-white/8 font-mono">
                  Live Concurrency
                </span>
              </div>
              <div className="mt-4">
                <div className="font-mono text-3xl font-bold tracking-tight text-white">
                  {activeMetrics?.activeTraceCount ?? 0}
                </div>
              </div>
            </div>
          </ProximityGlowCard>

          <ProximityGlowCard
            radius={240}
            intensity={0.9}
            className="border border-white/8 bg-zinc-900/60"
            title="Mean Latency"
            subtitle="Average per-span duration"
          >
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/10 text-zinc-200">
                  <Clock size={18} />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold px-2 py-0.5 rounded-lg bg-zinc-800/60 border border-white/8 font-mono">
                  Mean Duration
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <div className="font-mono text-3xl font-bold tracking-tight text-white">
                  {activeMetrics?.meanLatencyMs ?? 0}
                </div>
                <span className="text-sm font-medium text-zinc-500 font-mono">
                  ms
                </span>
              </div>
            </div>
          </ProximityGlowCard>

          <ProximityGlowCard
            radius={240}
            intensity={0.9}
            className="border border-white/8 bg-zinc-900/60"
            title="P95 Latency"
            subtitle="95th percentile execution tail"
          >
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/10 text-zinc-200">
                  <Zap size={18} />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-300 font-semibold px-2 py-0.5 rounded-lg bg-zinc-800/60 border border-white/8 font-mono">
                  Tail Threshold
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <div className="font-mono text-3xl font-bold tracking-tight text-zinc-100">
                  {activeMetrics?.p95LatencyMs ?? 0}
                </div>
                <span className="text-sm font-medium text-zinc-500 font-mono">
                  ms
                </span>
              </div>
            </div>
          </ProximityGlowCard>

          <ProximityGlowCard
            radius={240}
            intensity={0.9}
            className="border border-white/8 bg-zinc-900/60"
            title="Tool Error Rate"
            subtitle={`${activeMetrics?.toolCallsFailed ?? 0} failed / ${activeMetrics?.toolCallsTotal ?? 0} calls`}
          >
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div
                  className={`p-2 rounded-lg border ${
                    (activeMetrics?.toolErrorRate ?? 0) === 0
                      ? "bg-zinc-800/80 border-white/10 text-zinc-200"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  }`}
                >
                  <Shield size={18} />
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-lg border font-mono ${
                    (activeMetrics?.toolErrorRate ?? 0) === 0
                      ? "bg-zinc-800/60 border-white/8 text-zinc-300"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  }`}
                >
                  Reliability
                </span>
              </div>
              <div className="mt-4">
                <div
                  className={`font-mono text-3xl font-bold tracking-tight ${
                    (activeMetrics?.toolErrorRate ?? 0) === 0
                      ? "text-white"
                      : "text-rose-400"
                  }`}
                >
                  {(activeMetrics?.toolErrorRate ?? 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </ProximityGlowCard>
        </div>

        {/* Subsystem Metrics Grid: Context, Models & Roles */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TokenUsagePanel
            tokenMetrics={metrics?.tokenMetrics}
            activeSessionCount={
              Object.keys(metrics?.sessionMetrics ?? {}).length
            }
          />

          <ModelUsagePanel
            modelMetrics={metrics?.modelMetrics}
            totalSpansRecorded={metrics?.totalSpansRecorded ?? 0}
          />
        </div>

        {/* Agent Roles & Cross-Session Traffic */}
        <RoleActivityPanel
          roleMetrics={metrics?.roleMetrics}
          crossSessionMetrics={metrics?.crossSessionMetrics}
          totalSpansRecorded={metrics?.totalSpansRecorded ?? 0}
        />

        {/* Charts & Distribution Section */}
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

        {/* Distributed Trace Explorer Table */}
        <Card className="border border-white/8 bg-zinc-900/70 shadow-2xl">
          <CardHeader className="flex flex-row items-center justify-between border-b border-white/8 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-zinc-400" />
                <CardTitle className="text-base font-semibold text-white">
                  Distributed Trace Explorer
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-zinc-400 mt-1">
                End-to-end W3C TraceContext spans across TS Orchestrator → gRPC
                → Rust Executor → Sandbox
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-white/10 text-zinc-300 font-mono">
                {activeMetrics?.spans.length ?? 0} spans recorded
              </span>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/8 text-zinc-400 font-medium bg-zinc-950/60 font-mono">
                  <tr>
                    <th className="py-3 px-4">Operation / Span Name</th>
                    <th className="py-3 px-4">Session Scope</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Span ID</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {(activeMetrics?.spans ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-12 text-center text-zinc-500 font-mono"
                      >
                        <Terminal
                          size={24}
                          className="mx-auto mb-2 opacity-40"
                        />
                        <p>No distributed spans recorded for current filter.</p>
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
                            <tr className="hover:bg-white/2 transition-colors group">
                              <td className="py-3 px-4 font-medium text-zinc-200">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`h-2 w-2 rounded-full shrink-0 ${
                                      isError ? "bg-rose-500" : "bg-emerald-400"
                                    }`}
                                  />
                                  <span className="truncate max-w-xs">
                                    {span.name}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-zinc-400">
                                <span className="px-2 py-0.5 rounded-md bg-zinc-800/60 border border-white/5">
                                  {sessId}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-zinc-300">
                                {span.durationMs !== undefined ? (
                                  <span className="font-semibold text-zinc-100">
                                    {span.durationMs}ms
                                  </span>
                                ) : (
                                  <span className="text-amber-400 animate-pulse">
                                    running...
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                                    isError
                                      ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                      : "bg-zinc-800 text-zinc-300 border-white/10"
                                  }`}
                                >
                                  {span.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-zinc-400">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-500">
                                    {span.id.substring(0, 12)}...
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyTrace(span.id)}
                                    className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                                    title="Copy span ID"
                                  >
                                    {copiedTraceId === span.id ? (
                                      <Check
                                        size={12}
                                        className="text-emerald-400"
                                      />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    setExpandedTraceId(
                                      isExpanded ? null : span.id,
                                    )
                                  }
                                  className="font-mono text-[11px] gap-1 text-zinc-400 hover:text-white"
                                >
                                  <span>{isExpanded ? "Hide" : "View"}</span>
                                  {isExpanded ? (
                                    <ChevronUp size={12} />
                                  ) : (
                                    <ChevronDown size={12} />
                                  )}
                                </Button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-zinc-950/80">
                                <td
                                  colSpan={6}
                                  className="p-4 sm:p-6 border-y border-white/8 space-y-3"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                                      <Terminal
                                        size={14}
                                        className="text-zinc-400"
                                      />
                                      <span>
                                        W3C TraceContext Payload & OpenTelemetry
                                        Span Envelope
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyTrace(
                                          JSON.stringify(span, null, 2),
                                        )
                                      }
                                      className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                                    >
                                      <Copy size={12} />
                                      <span>Copy JSON</span>
                                    </button>
                                  </div>
                                  <pre className="rounded-lg bg-zinc-900 border border-white/10 p-4 text-[11px] leading-relaxed text-zinc-300 overflow-x-auto font-mono">
                                    {JSON.stringify(
                                      {
                                        id: span.id,
                                        name: span.name,
                                        status: span.status,
                                        durationMs: span.durationMs,
                                        startTime: span.startTime,
                                        attributes: span.attributes,
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
