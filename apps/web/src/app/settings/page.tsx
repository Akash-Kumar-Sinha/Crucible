"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { orchestratorClient } from "../../api/orchestrator-client";
import { useSessionStore } from "../../stores/session-store";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { readTenantScope } from "../../config/tenant-scope";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Key,
  ShieldCheck,
  Activity,
  Terminal,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  Zap,
} from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());

  // API Key State
  const [apiKey, setApiKey] = React.useState<string>("");
  const [showKey, setShowKey] = React.useState(false);
  const [keySaved, setKeySaved] = React.useState(false);
  const [testingKey, setTestingKey] = React.useState(false);
  const [keyStatus, setKeyStatus] = React.useState<
    "idle" | "valid" | "invalid"
  >("idle");
  const [keyStatusMsg, setKeyStatusMsg] = React.useState("");

  // SDK Token State
  const [sdkToken, setSdkToken] = React.useState<string>("");
  const [copiedToken, setCopiedToken] = React.useState(false);
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);

  // Resilience & Circuit Breakers Telemetry
  const [resilienceData, setResilienceData] = React.useState<any>(null);
  const [loadingResilience, setLoadingResilience] = React.useState(true);
  const [actionInProgress, setActionInProgress] = React.useState<string | null>(
    null,
  );

  // Initialize from localStorage
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("crucible_openrouter_api_key");
      if (stored) setApiKey(stored);

      // Generate or retrieve SDK Session Token
      let token = localStorage.getItem("crucible_sdk_session_token");
      if (!token) {
        token = `crucible_sk_${Math.random().toString(36).substring(2, 15)}_${Date.now().toString(36)}`;
        localStorage.setItem("crucible_sdk_session_token", token);
      }
      setSdkToken(token);
    }
  }, []);

  // Fetch live resilience metrics
  const fetchResilience = React.useCallback(async () => {
    try {
      const data = await orchestratorClient.getResilienceStatus();
      setResilienceData(data);
    } catch {
      // Non-blocking
    } finally {
      setLoadingResilience(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchResilience();
    const interval = setInterval(() => {
      void fetchResilience();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchResilience]);

  React.useEffect(() => {
    orchestratorClient
      .listSessionsWithScope(activeScope)
      .then(setSessions)
      .catch(() => {});
  }, [setSessions, activeScope]);

  const handleSaveApiKey = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("crucible_openrouter_api_key", apiKey.trim());
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2000);
    }
  };

  const handleTestApiKey = async () => {
    setTestingKey(true);
    setKeyStatus("idle");
    setKeyStatusMsg("");
    try {
      const models = await orchestratorClient.listModels();
      if (models && models.length > 0) {
        setKeyStatus("valid");
        setKeyStatusMsg(
          `Connection successful. Discovered ${models.length} available models.`,
        );
      } else {
        setKeyStatus("valid");
        setKeyStatusMsg("Gateway reachable and operational.");
      }
    } catch (err: any) {
      setKeyStatus("invalid");
      setKeyStatusMsg(
        err?.message || "Failed to reach LLM gateway with the provided key.",
      );
    } finally {
      setTestingKey(false);
    }
  };

  const handleCopyToken = () => {
    if (typeof navigator !== "undefined" && sdkToken) {
      void navigator.clipboard.writeText(sdkToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleCopySnippet = () => {
    const snippet = `export CRUCIBLE_API_TOKEN="${sdkToken}"\ncrucible doctor`;
    if (typeof navigator !== "undefined") {
      void navigator.clipboard.writeText(snippet);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
  };

  const handleResetBreaker = async (name: string) => {
    setActionInProgress(name);
    try {
      await orchestratorClient.resetCircuitBreaker(name);
      await fetchResilience();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTripBreaker = async (name: string) => {
    setActionInProgress(name);
    try {
      await orchestratorClient.tripCircuitBreaker(
        name,
        "Manual chaos test from settings dashboard",
      );
      await fetchResilience();
    } finally {
      setActionInProgress(null);
    }
  };

  const breakers = resilienceData?.breakers || [
    {
      name: "openrouter_llm",
      state: "closed",
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      failureCount: 0,
    },
    {
      name: "executor_core",
      state: "closed",
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      failureCount: 0,
    },
    {
      name: "rust_grpc",
      state: "closed",
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      failureCount: 0,
    },
    {
      name: "docker_engine",
      state: "closed",
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      failureCount: 0,
    },
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100 font-sans">
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
            onScopeChange={(next) => setActiveScope(next)}
          />
        </Sidebar>

        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
          {/* Top Header */}
          <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/90 backdrop-blur-md z-10 font-mono shrink-0">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
              <Separator
                orientation="vertical"
                className="h-4 bg-white/10 mx-1"
              />
              <Link
                href="/workspace/session"
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                title="Back to Session"
              >
                <ArrowLeft size={14} />
              </Link>
              <div className="flex items-center gap-2">
                <Key size={16} className="text-blue-400" />
                <span className="text-xs text-white font-semibold uppercase tracking-wider">
                  Settings & Developer Access
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded border border-white/10 bg-zinc-900 text-[10px] font-mono text-zinc-400">
                Scope: {activeScope.tenantId || "default"}
              </span>
            </div>
          </header>

          {/* Main Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto w-full">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Platform Configuration & Resilience
              </h1>
              <p className="text-xs text-zinc-400 mt-1">
                Configure OpenRouter provider credentials, developer SDK tokens,
                and inspect upstream circuit breakers in real time.
              </p>
            </div>

            {/* Section 1: OpenRouter API Key */}
            <Card className="bg-zinc-900/70 border-white/8 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <Key size={18} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      OpenRouter LLM Gateway
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Unified model provider gateway for Claude 3.5, GPT-4o,
                      Gemini 2.0, DeepSeek, and free-tier models.
                    </p>
                  </div>
                </div>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1 font-mono"
                >
                  Get API Key ↗
                </a>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="bg-zinc-950 border-white/10 font-mono text-xs pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Button
                    onClick={handleSaveApiKey}
                    className="bg-zinc-800 hover:bg-zinc-700 text-white font-sans text-xs px-4"
                  >
                    {keySaved ? (
                      <Check size={14} className="text-emerald-400 mr-1" />
                    ) : null}
                    {keySaved ? "Saved" : "Save Key"}
                  </Button>
                  <Button
                    onClick={() => void handleTestApiKey()}
                    disabled={testingKey}
                    variant="outline"
                    className="border-white/10 hover:bg-white/5 text-zinc-300 font-sans text-xs px-3"
                  >
                    {testingKey ? (
                      <RefreshCw size={14} className="animate-spin mr-1" />
                    ) : (
                      <Zap size={14} className="mr-1 text-amber-400" />
                    )}
                    {testingKey ? "Testing..." : "Test"}
                  </Button>
                </div>

                {keyStatus !== "idle" && (
                  <div
                    className={`p-3 rounded-lg border text-xs font-mono flex items-start gap-2 ${
                      keyStatus === "valid"
                        ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                        : "bg-rose-950/40 border-rose-500/30 text-rose-300"
                    }`}
                  >
                    {keyStatus === "valid" ? (
                      <Check size={14} className="shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    )}
                    <span>{keyStatusMsg}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Section 2: Developer SDK & CLI Access */}
            <Card className="bg-zinc-900/70 border-white/8 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Terminal size={18} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Developer SDK & CLI Access
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Connect via{" "}
                      <code className="font-mono text-zinc-300">
                        @crucible/sdk
                      </code>{" "}
                      and the{" "}
                      <code className="font-mono text-zinc-300">crucible</code>{" "}
                      command line tool.
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Active Session
                </span>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-mono text-zinc-400 block mb-1.5">
                    Session API Token
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      readOnly
                      value={sdkToken}
                      className="bg-zinc-950 border-white/10 font-mono text-xs text-zinc-300"
                    />
                    <Button
                      onClick={handleCopyToken}
                      className="bg-zinc-800 hover:bg-zinc-700 text-white font-sans text-xs px-4 shrink-0"
                    >
                      {copiedToken ? (
                        <Check size={14} className="text-emerald-400 mr-1" />
                      ) : (
                        <Copy size={14} className="mr-1" />
                      )}
                      {copiedToken ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg bg-zinc-950 border border-white/8 p-3 font-mono text-xs space-y-2">
                  <div className="flex items-center justify-between text-zinc-400 text-[11px] pb-1 border-b border-white/5">
                    <span>CLI Quickstart</span>
                    <button
                      onClick={handleCopySnippet}
                      className="text-zinc-400 hover:text-white flex items-center gap-1"
                    >
                      {copiedSnippet ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                      <span>{copiedSnippet ? "Copied" : "Copy Snippet"}</span>
                    </button>
                  </div>
                  <pre className="text-zinc-300 overflow-x-auto select-all">
                    export CRUCIBLE_API_TOKEN=&quot;{sdkToken}&quot;{`\n`}
                    crucible doctor --endpoint http://localhost:4000
                  </pre>
                </div>
              </div>
            </Card>

            {/* Section 3: Upstream Resilience & Circuit Breakers (Hystrix-Style Monitor) */}
            <Card className="bg-zinc-900/70 border-white/8 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Activity size={18} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Resilience & Circuit Breakers
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Real-time Hystrix-style circuit breaker telemetry across
                      upstream LLM gateways and executor microVMs.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => void fetchResilience()}
                  variant="outline"
                  size="sm"
                  className="border-white/10 hover:bg-white/5 text-zinc-300 font-mono text-xs h-7"
                >
                  <RefreshCw
                    size={12}
                    className={`mr-1 ${loadingResilience ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-zinc-400 text-[11px]">
                      <th className="py-2 px-3">Service</th>
                      <th className="py-2 px-3">State</th>
                      <th className="py-2 px-3 text-right">Total Calls</th>
                      <th className="py-2 px-3 text-right">Success / Fail</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-300">
                    {breakers.map((b: any) => {
                      const isOpen = b.state === "open";
                      const isHalfOpen = b.state === "half_open";

                      const badgeClass = isOpen
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        : isHalfOpen
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";

                      return (
                        <tr key={b.name} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {b.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}
                            >
                              {b.state}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {b.totalCalls ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="text-emerald-400">
                              {b.totalSuccesses ?? 0}
                            </span>
                            {" / "}
                            <span className="text-rose-400">
                              {b.totalFailures ?? 0}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-1.5">
                            <button
                              onClick={() => void handleResetBreaker(b.name)}
                              disabled={actionInProgress === b.name}
                              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-sans transition-colors disabled:opacity-50"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => void handleTripBreaker(b.name)}
                              disabled={actionInProgress === b.name}
                              className="px-2 py-0.5 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-500/30 text-[11px] font-sans transition-colors disabled:opacity-50"
                              title="Chaos test trip"
                            >
                              Trip
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Section 4: Rate Limiting & Financial Governance */}
            <Card className="bg-zinc-900/70 border-white/8 p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    Rate Limiting & Spending Controls
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Token bucket rate limiting and per-turn financial circuit
                    breakers protect against unexpected cloud costs.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 font-mono">
                <div className="p-3 rounded-lg bg-zinc-950 border border-white/8 space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Per-Session Limit
                  </span>
                  <div className="text-base font-bold text-white">
                    30 req/min
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Burst capacity: 30 tokens
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-950 border border-white/8 space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Per-Tenant Limit
                  </span>
                  <div className="text-base font-bold text-white">
                    120 req/min
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Tenant bulkhead pool
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-950 border border-white/8 space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Max Cost / Run
                  </span>
                  <div className="text-base font-bold text-emerald-400">
                    $2.00 USD
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Turn spending ceiling
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-950 border border-white/8 space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Max Cost / Session
                  </span>
                  <div className="text-base font-bold text-emerald-400">
                    $20.00 USD
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Aggregate session budget
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
