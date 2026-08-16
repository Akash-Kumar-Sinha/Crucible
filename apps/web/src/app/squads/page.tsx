"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  orchestratorClient,
  type SquadInfo,
} from "../../api/orchestrator-client";
import { useSessionStore } from "../../stores/session-store";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { RoleAvatar } from "@/components/workspace/RoleAvatar";
import { readTenantScope } from "../../config/tenant-scope";
import { Layers, Plus, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default function SquadsOverviewPage() {
  const router = useRouter();
  const [squads, setSquads] = React.useState<SquadInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newSquadName, setNewSquadName] = React.useState("");
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());

  const fetchSquads = React.useCallback(async () => {
    try {
      const res = await orchestratorClient.getSquads();
      setSquads(res.squads || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load squads list.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchSquads();
    const interval = setInterval(() => {
      void fetchSquads();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchSquads]);

  React.useEffect(() => {
    orchestratorClient
      .listSessionsWithScope(activeScope)
      .then(setSessions)
      .catch(() => {});
  }, [setSessions, activeScope]);

  const handleCreateSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSquadName.trim()) return;
    try {
      setCreating(true);
      const res = await orchestratorClient.createSquad({
        name: newSquadName.trim(),
        autoCreateSessions: true,
        tenantId: activeScope.tenantId,
        namespace: activeScope.namespace,
      });
      setShowCreateModal(false);
      setNewSquadName("");
      router.push(`/squads/${encodeURIComponent(res.squad.id)}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create squad.");
    } finally {
      setCreating(false);
    }
  };

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
            onScopeChange={(next) => {
              setActiveScope(next);
            }}
          />
        </Sidebar>

        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
          {/* Header */}
          <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/90 backdrop-blur-md z-10 font-mono">
            <div className="flex items-center gap-2.5">
              <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
              <Separator
                orientation="vertical"
                className="h-4 bg-white/10 mx-1"
              />
              <Layers size={16} className="text-sky-400" />
              <h1 className="text-sm font-semibold text-white tracking-tight">
                Multi-Agent Squad Orchestrator
              </h1>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => setShowCreateModal(true)}
              className="h-8 px-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
            >
              <Plus size={13} className="mr-1.5" />
              New Squad
            </Button>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 font-mono">
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    Autonomous Multi-Agent Squads
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Ordered hand-off pipelines (Coder → Test Writer → Bug Hunter
                    → Bug Fixer) running state-machine workflows.
                  </p>
                </div>

                <span className="text-xs text-zinc-500">
                  {squads.length} active squad{squads.length === 1 ? "" : "s"}
                </span>
              </div>

              {error && (
                <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-950/30 text-rose-300 text-xs">
                  {error}
                </div>
              )}

              {loading && squads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-zinc-400 gap-2">
                  <Loader2 size={24} className="animate-spin text-sky-400" />
                  <span className="text-xs">Loading squads...</span>
                </div>
              ) : squads.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center rounded-lg border border-white/8 bg-zinc-900/60 space-y-4">
                  <Layers size={40} className="text-zinc-600 animate-pulse" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-zinc-300">
                      No Squads Active
                    </h3>
                    <p className="text-xs text-zinc-500 max-w-sm">
                      Provision a multi-agent squad to automatically orchestrate
                      the coding, QA test authoring, security probing, and bug
                      fixing loop.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="h-9 px-4 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                  >
                    <Plus size={13} className="mr-1.5" />
                    Provision First Squad
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {squads.map((s) => {
                    const isStalled = s.stage === "stalled";
                    return (
                      <Link
                        key={s.id}
                        href={`/squads/${encodeURIComponent(s.id)}`}
                        className="group block rounded-lg border border-white/8 bg-zinc-900/80 hover:bg-zinc-800/80 hover:border-white/15 p-5 transition-all shadow-sm space-y-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                                {s.name}
                              </h3>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                  isStalled
                                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                                    : s.stage === "completed"
                                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                      : "bg-sky-500/20 text-sky-300 border-sky-500/30"
                                }`}
                              >
                                {s.stage}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 line-clamp-1">
                              {s.statusLine || "Awaiting task execution"}
                            </p>
                          </div>

                          <ArrowRight
                            size={16}
                            className="text-zinc-500 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0 mt-1"
                          />
                        </div>

                        {/* Roster Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-white/5">
                          {Object.entries(s.members || {}).map(
                            ([roleKey, member]) => (
                              <RoleAvatar
                                key={roleKey}
                                role={member.role}
                                model={member.model}
                                active={s.activeRole === member.role}
                                size="sm"
                                showLink={false}
                              />
                            ),
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
                          <div className="flex items-center gap-1">
                            <RefreshCw size={10} className="text-amber-400" />
                            <span>
                              Fix Iterations: {s.fixIterationCount} /{" "}
                              {s.maxFixIterations}
                            </span>
                          </div>
                          <span>ID: {s.id}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Create Squad Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-mono">
              <div className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-sky-400" />
                    <h3 className="text-sm font-bold text-white">
                      Provision Multi-Agent Squad
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="text-zinc-500 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateSquad} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-300 font-medium">
                      Squad Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newSquadName}
                      onChange={(e) => setNewSquadName(e.target.value)}
                      placeholder="e.g. auth-security-squad"
                      className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="p-3 rounded-lg bg-black/40 border border-white/5 text-[11px] text-zinc-400 space-y-1">
                    <div className="font-semibold text-zinc-300">
                      Auto-Provisioned Roles:
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-zinc-400">
                      <li>Coder (Implementation)</li>
                      <li>Test Writer (QA & Test suites)</li>
                      <li>Bug Hunter (Adversarial security audit)</li>
                      <li>Bug Fixer (Surgical patches)</li>
                    </ul>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateModal(false)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={creating || !newSquadName.trim()}
                      className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                    >
                      {creating ? "Provisioning..." : "Create Squad"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
