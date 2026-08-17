"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
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
  RefreshCw,
  Search,
  Cpu,
  Bot,
  Gauge,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { motion, AnimatePresence, type Variants } from "motion/react";
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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOrchestratorUrl } from "@/config/orchestrator-url";
import {
  orchestratorClient,
  type SessionSummary,
  type TenantScope,
} from "@/api/orchestrator-client";
import { readTenantScope } from "@/config/tenant-scope";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

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

type MetricsViewTab = "all" | "context-models" | "roles-bus" | "traces";

const METRICS_TABS: Array<{
  id: MetricsViewTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "all", label: "All Telemetry", icon: <Gauge size={13} /> },
  { id: "context-models", label: "Context & Models", icon: <Cpu size={13} /> },
  { id: "roles-bus", label: "Roles & Session Bus", icon: <Bot size={13} /> },
  { id: "traces", label: "Trace Explorer", icon: <Layers size={13} /> },
];

const containerMotionVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const cardMotionVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" },
  },
};

export default function MetricsDashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeScope, setActiveScope] = useState<TenantScope>(() =>
    readTenantScope(),
  );
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<MetricsViewTab>("all");
  const [isConnected, setIsConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [copiedTraceId, setCopiedTraceId] = useState<string | null>(null);

  const fetchMetricsData = async () => {
    setIsRefreshing(true);
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
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  useEffect(() => {
    orchestratorClient
      .listSessionsWithScope(activeScope)
      .then(setSessions)
      .catch(() => {});
  }, [activeScope]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollTimer: any = null;

    fetchMetricsData();

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
          pollTimer = setInterval(fetchMetricsData, 2000);
        }
      };
    } catch {
      pollTimer = setInterval(fetchMetricsData, 2000);
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

  const filteredSpans = useMemo(() => {
    const allSpans = activeMetrics?.spans ?? [];
    if (!searchQuery.trim()) return allSpans;
    const q = searchQuery.toLowerCase();
    return allSpans.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        ((s.attributes?.sessionId as string) || "").toLowerCase().includes(q),
    );
  }, [activeMetrics?.spans, searchQuery]);

  const handleCopyTrace = (traceId: string) => {
    navigator.clipboard.writeText(traceId);
    setCopiedTraceId(traceId);
    setTimeout(() => setCopiedTraceId(null), 2000);
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
        <Sidebar
          className="border-r border-white/8 bg-zinc-900"
          collapsible="icon"
        >
          <SessionSidebar
            sessions={sessions}
            onCreateSession={async () => {
              const sess = await orchestratorClient.createSession(
                undefined,
                undefined,
                activeScope,
              );
              setSessions(
                await orchestratorClient.listSessionsWithScope(activeScope),
              );
              router.push(`/workspace/session/${sess.id}`);
            }}
            onDeleteSession={async (id) => {
              await orchestratorClient.deleteSession(id);
              setSessions(
                await orchestratorClient.listSessionsWithScope(activeScope),
              );
            }}
            tenantId={activeScope.tenantId}
            namespace={activeScope.namespace}
            onScopeChange={(next) => {
              setActiveScope(next);
            }}
          />
        </Sidebar>

        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
          {/* Header Bar */}
          <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/90 backdrop-blur-md z-10 font-mono shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
              <Separator
                orientation="vertical"
                className="h-4 bg-white/10 mx-1"
              />
              <div className="p-1 rounded-md bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 shrink-0">
                <Activity size={15} />
              </div>
              <div className="flex items-center gap-2 truncate">
                <h1 className="text-sm font-semibold text-white tracking-tight truncate">
                  Telemetry & Distributed Traces
                </h1>
                <div
                  className={cn(
                    "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors font-mono",
                    isConnected
                      ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300"
                      : "border-zinc-800 bg-zinc-900 text-zinc-500",
                  )}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    {isConnected && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex h-1.5 w-1.5 rounded-full",
                        isConnected ? "bg-emerald-400" : "bg-zinc-600",
                      )}
                    />
                  </span>
                  <span>{isConnected ? "Live SSE" : "Polling"}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Session Scope Filter */}
              <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/80 px-2.5 py-1 backdrop-blur-md hover:border-white/20 transition-all text-xs font-mono">
                <Filter size={12} className="text-zinc-400" />
                <span className="text-zinc-500 hidden md:inline text-[11px]">
                  Scope:
                </span>
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

              {/* Refresh Trigger */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMetricsData()}
                disabled={isRefreshing}
                className="h-8 w-8 p-0 text-zinc-400 hover:text-white border-white/10 bg-zinc-900/80 cursor-pointer"
                title="Refresh metrics telemetry"
              >
                {isRefreshing ? (
                  <Spinner className="size-3.5 text-sky-400" />
                ) : (
                  <RefreshCw size={13} />
                )}
              </Button>

              <Link href="/workspace/session">
                <Button size="sm" className="h-8 gap-1.5 text-xs font-mono">
                  <span>Session</span>
                </Button>
              </Link>
            </div>
          </header>

          {/* Sub-Header Navigation Tabs */}
          <div className="border-b border-white/8 bg-zinc-950/50 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap shrink-0">
            {/* View Selector with Motion layoutId Indicator */}
            <div className="flex items-center space-x-1 rounded-lg bg-zinc-900/80 p-1 border border-white/8 font-mono text-xs">
              {METRICS_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors rounded-md focus-visible:outline-none cursor-pointer",
                      isActive
                        ? "text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200",
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="metrics-view-tab-indicator"
                        className="absolute inset-0 bg-zinc-800 rounded-md shadow-sm border border-white/10"
                        transition={{
                          type: "spring",
                          stiffness: 450,
                          damping: 30,
                        }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      {tab.icon}
                      <span>{tab.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quick Stats Summary Pill */}
            <div className="hidden lg:flex items-center gap-4 text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">Total Spans:</span>
                <span className="text-zinc-200 font-semibold">
                  {metrics?.totalSpansRecorded ?? 0}
                </span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">Tracked Sessions:</span>
                <span className="text-zinc-200 font-semibold">
                  {sessionIds.length}
                </span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">Bus Traffic:</span>
                <span className="text-zinc-200 font-semibold">
                  {metrics?.crossSessionMetrics?.totalPublished ?? 0} msgs
                </span>
              </div>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-8">
            {/* Top KPI Cards Grid with Motion Entrance */}
            <motion.div
              variants={containerMotionVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              {/* Active Traces */}
              <motion.div
                variants={cardMotionVariants}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <Card className="border border-white/10 bg-zinc-900/80 shadow-lg backdrop-blur-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/8 text-zinc-200">
                        <Activity size={17} />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold px-2 py-0.5 rounded bg-zinc-800/60 border border-white/5">
                        Live Concurrency
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="font-mono text-3xl font-bold tracking-tight text-white">
                      {activeMetrics?.activeTraceCount ?? 0}
                    </div>
                    <p className="text-[11px] text-zinc-400 font-sans mt-1">
                      In-flight asynchronous spans
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Mean Latency */}
              <motion.div
                variants={cardMotionVariants}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <Card className="border border-white/10 bg-zinc-900/80 shadow-lg backdrop-blur-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/8 text-zinc-200">
                        <Clock size={17} />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold px-2 py-0.5 rounded bg-zinc-800/60 border border-white/5">
                        Mean Duration
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-baseline gap-1 font-mono">
                      <span className="text-3xl font-bold tracking-tight text-white">
                        {activeMetrics?.meanLatencyMs ?? 0}
                      </span>
                      <span className="text-sm font-medium text-zinc-500">
                        ms
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-sans mt-1">
                      Average per-span execution latency
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* P95 Latency */}
              <motion.div
                variants={cardMotionVariants}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <Card className="border border-white/10 bg-zinc-900/80 shadow-lg backdrop-blur-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-zinc-800/80 border border-white/8 text-zinc-200">
                        <Zap size={17} />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold px-2 py-0.5 rounded bg-zinc-800/60 border border-white/5">
                        P95 Tail
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-baseline gap-1 font-mono">
                      <span className="text-3xl font-bold tracking-tight text-zinc-100">
                        {activeMetrics?.p95LatencyMs ?? 0}
                      </span>
                      <span className="text-sm font-medium text-zinc-500">
                        ms
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-sans mt-1">
                      95th percentile execution ceiling
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Tool Error Rate */}
              <motion.div
                variants={cardMotionVariants}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <Card className="border border-white/10 bg-zinc-900/80 shadow-lg backdrop-blur-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div
                        className={cn(
                          "p-2 rounded-lg border",
                          (activeMetrics?.toolErrorRate ?? 0) === 0
                            ? "bg-zinc-800/80 border-white/8 text-zinc-200"
                            : "bg-rose-500/10 border-rose-500/20 text-rose-400",
                        )}
                      >
                        <Shield size={17} />
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded border",
                          (activeMetrics?.toolErrorRate ?? 0) === 0
                            ? "bg-zinc-800/60 border-white/5 text-zinc-300"
                            : "bg-rose-500/10 border-rose-500/20 text-rose-400",
                        )}
                      >
                        {(activeMetrics?.toolErrorRate ?? 0) === 0
                          ? "100% Reliable"
                          : "Degraded"}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div
                      className={cn(
                        "font-mono text-3xl font-bold tracking-tight",
                        (activeMetrics?.toolErrorRate ?? 0) === 0
                          ? "text-white"
                          : "text-rose-400",
                      )}
                    >
                      {(activeMetrics?.toolErrorRate ?? 0).toFixed(1)}%
                    </div>
                    <p className="text-[11px] text-zinc-400 font-sans mt-1">
                      {activeMetrics?.toolCallsFailed ?? 0} failed /{" "}
                      {activeMetrics?.toolCallsTotal ?? 0} tool invocations
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>

            {/* Dynamic View Content based on activeTab */}
            <AnimatePresence mode="wait">
              {(activeTab === "all" || activeTab === "context-models") && (
                <motion.div
                  key="context-models-section"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
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
                </motion.div>
              )}

              {(activeTab === "all" || activeTab === "roles-bus") && (
                <motion.div
                  key="roles-bus-section"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <RoleActivityPanel
                    roleMetrics={metrics?.roleMetrics}
                    crossSessionMetrics={metrics?.crossSessionMetrics}
                    totalSpansRecorded={metrics?.totalSpansRecorded ?? 0}
                  />
                </motion.div>
              )}

              {(activeTab === "all" || activeTab === "traces") && (
                <motion.div
                  key="traces-section"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  {/* Latency Charts & Tool Reliability Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <LatencyChart
                      meanLatencyMs={activeMetrics?.meanLatencyMs ?? 0}
                      p50LatencyMs={activeMetrics?.p50LatencyMs ?? 0}
                      p95LatencyMs={activeMetrics?.p95LatencyMs ?? 0}
                      p99LatencyMs={activeMetrics?.p99LatencyMs ?? 0}
                      spans={activeMetrics?.spans ?? []}
                      sessionId={
                        selectedSessionId !== "all"
                          ? selectedSessionId
                          : undefined
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
                  <Card className="border border-white/10 bg-zinc-900/80 shadow-2xl overflow-hidden font-mono">
                    <CardHeader className="border-b border-white/8 pb-3.5 bg-zinc-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Layers size={16} className="text-zinc-400" />
                          <CardTitle className="text-sm font-semibold text-white tracking-wide">
                            Distributed Trace Explorer
                          </CardTitle>
                        </div>
                        <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
                          End-to-end W3C TraceContext spans across Orchestrator
                          → gRPC → Rust Executor → Sandbox
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {/* Span search filter input */}
                        <div className="relative">
                          <Search
                            size={12}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                          />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter spans..."
                            className="w-36 sm:w-48 pl-7 pr-2.5 py-1 text-xs rounded-md bg-zinc-800/80 border border-white/10 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/20"
                          />
                        </div>

                        <span className="text-xs px-2 py-1 rounded-md bg-zinc-800/80 border border-white/10 text-zinc-300">
                          {filteredSpans.length} spans
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-white/8 text-zinc-400 font-medium bg-zinc-950/60">
                            <tr>
                              <th className="py-2.5 px-4">
                                Operation / Span Name
                              </th>
                              <th className="py-2.5 px-4">Session Scope</th>
                              <th className="py-2.5 px-4">Duration</th>
                              <th className="py-2.5 px-4">Status</th>
                              <th className="py-2.5 px-4">Span ID</th>
                              <th className="py-2.5 px-4 text-right">
                                Inspect
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {filteredSpans.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="py-12 text-center text-zinc-500 font-sans text-xs"
                                >
                                  <Terminal
                                    size={24}
                                    className="mx-auto mb-2 opacity-40"
                                  />
                                  <p>
                                    No distributed spans found matching current
                                    scope or search filter.
                                  </p>
                                </td>
                              </tr>
                            ) : (
                              filteredSpans
                                .slice()
                                .reverse()
                                .map((span) => {
                                  const isExpanded =
                                    expandedTraceId === span.id;
                                  const isError = span.status === "ERROR";
                                  const sessId =
                                    (span.attributes?.sessionId as string) ||
                                    "global";

                                  return (
                                    <React.Fragment key={span.id}>
                                      <tr className="hover:bg-white/2 transition-colors group">
                                        <td className="py-2.5 px-4 font-medium text-zinc-200">
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={cn(
                                                "h-1.5 w-1.5 rounded-full shrink-0",
                                                isError
                                                  ? "bg-rose-500"
                                                  : "bg-emerald-400",
                                              )}
                                            />
                                            <span className="truncate max-w-xs">
                                              {span.name}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-4 text-zinc-400">
                                          <span className="px-2 py-0.5 rounded bg-zinc-800/60 border border-white/5 text-[11px]">
                                            {sessId}
                                          </span>
                                        </td>
                                        <td className="py-2.5 px-4 text-zinc-300">
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
                                        <td className="py-2.5 px-4">
                                          <span
                                            className={cn(
                                              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border",
                                              isError
                                                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                                : "bg-zinc-800 text-zinc-300 border-white/10",
                                            )}
                                          >
                                            {span.status}
                                          </span>
                                        </td>
                                        <td className="py-2.5 px-4 text-zinc-400">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-zinc-500">
                                              {span.id.substring(0, 12)}...
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleCopyTrace(span.id)
                                              }
                                              className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
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
                                        <td className="py-2.5 px-4 text-right">
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
                                            <span>
                                              {isExpanded ? "Hide" : "Inspect"}
                                            </span>
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
                                            className="p-4 sm:p-5 border-y border-white/8 space-y-2.5"
                                          >
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                                                <Terminal
                                                  size={14}
                                                  className="text-zinc-400"
                                                />
                                                <span>
                                                  W3C TraceContext Payload &
                                                  OpenTelemetry Span Envelope
                                                </span>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleCopyTrace(
                                                    JSON.stringify(
                                                      span,
                                                      null,
                                                      2,
                                                    ),
                                                  )
                                                }
                                                className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
                                              >
                                                <Copy size={12} />
                                                <span>Copy JSON</span>
                                              </button>
                                            </div>
                                            <pre className="rounded-lg bg-zinc-900/90 border border-white/10 p-3.5 text-[11px] leading-relaxed text-zinc-300 overflow-x-auto">
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
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
