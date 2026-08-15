"use client";

import * as React from "react";
import type { SessionSummary } from "../api/orchestrator-client";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  MessageSquare,
  Trash2,
  Activity,
  AlertCircle,
  X,
  Loader2,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SetupWizard } from "./SetupWizard";
import { Button } from "@/components/ui/button";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import {
  CommandPalette,
  useCommandPalette,
  type Command,
} from "@/components/ui/command-palette";

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onCreateSession: () => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  loading?: boolean;
  tenantId?: string;
  namespace?: string;
  onScopeChange?: (scope: { tenantId: string; namespace: string }) => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onCreateSession,
  onDeleteSession,
  loading = false,
  tenantId,
  namespace,
  onScopeChange,
}: SessionSidebarProps) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSetupOpen, setIsSetupOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();

  const handleCreate = async () => {
    setCreating(true);
    setErrorMessage(null);
    try {
      await onCreateSession();
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          "Failed to create session. Please check if 'make serve' is running on port 4000.",
      );
    } finally {
      setCreating(false);
    }
  };

  const filteredSessions = React.useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        s.id.toLowerCase().includes(q),
    );
  }, [sessions, searchQuery]);

  const commands: Command[] = [
    {
      id: "new-session",
      label: "New Session",
      description: "Create a fresh agent session",
      group: "Actions",
      icon: <Plus size={16} />,
      onSelect: () => {
        void handleCreate();
      },
    },
    {
      id: "setup",
      label: "Setup & Credentials",
      description: "OpenRouter key and model",
      group: "Actions",
      icon: <Settings size={16} />,
      onSelect: () => setIsSetupOpen(true),
    },
    {
      id: "metrics",
      label: "Metrics & Tracing",
      description: "OpenTelemetry dashboard",
      group: "Navigation",
      icon: <Activity size={16} />,
      onSelect: () => router.push("/metrics"),
    },
    ...sessions.map((session) => ({
      id: `session-${session.id}`,
      label: session.title || session.id,
      description: session.status,
      group: "Sessions",
      icon: <MessageSquare size={16} />,
      onSelect: () => router.push(`/session/${session.id}`),
    })),
  ];

  return (
    <aside className="w-72 min-w-72 bg-zinc-950/95 border-r border-white/8 flex flex-col h-screen select-none relative z-10 backdrop-blur-xl">
      {/* Brand Dock */}
      <div className="p-4 border-b border-white/8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo className="w-8 h-8 text-white transition-transform group-hover:scale-105" />
          <div className="flex flex-col">
            <CrucibleWordmark className="text-xl text-white group-hover:text-zinc-200 transition-colors leading-none" />
            <p className="text-[10px] text-zinc-500 font-mono tracking-wider mt-0.5">
              REASONING HARNESS
            </p>
          </div>
        </Link>
        <span className="rounded-full bg-white/5 border border-white/8 px-2 py-0.5 text-[9px] font-mono text-zinc-400">
          v0.1.0
        </span>
      </div>

      <div className="px-3 pt-3">
        <div className="rounded-xl border border-white/8 bg-zinc-900/60 px-3 py-2.5 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
            <span>Active Scope</span>
            <span>Bulkhead</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-zinc-200">
              Tenant: {tenantId || "default"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-zinc-200">
              Namespace: {namespace || "crucible"}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Action Button */}
      <div className="p-3">
        <Button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full gap-2 bg-white hover:bg-zinc-200 text-zinc-950 font-medium shadow-md transition-all active:scale-[0.98]"
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-950" />
          ) : (
            <Plus className="h-4 w-4 text-zinc-950" />
          )}
          <span>{creating ? "Creating..." : "New Session"}</span>
        </Button>
      </div>

      {/* Search Sessions Filter */}
      {sessions.length > 3 && (
        <div className="px-3 pb-2">
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-white/8 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-colors"
          />
        </div>
      )}

      {/* Inline Error Notice */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-3 mb-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2 leading-relaxed"
          >
            <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-400" />
            <div className="flex-1">{errorMessage}</div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-300 p-0.5"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
          <span>Active Sessions</span>
          <span>{filteredSessions.length}</span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-zinc-500 leading-relaxed">
            {searchQuery
              ? "No matching sessions found."
              : 'No active sessions. Click "New Session" to begin.'}
          </div>
        ) : (
          filteredSessions.map((s, idx) => {
            const isActive = s.id === activeSessionId;
            return (
              <motion.div
                key={`${s.id}-${idx}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: Math.min(idx * 0.02, 0.15),
                  duration: 0.18,
                }}
                className={`group relative flex items-center justify-between rounded-lg transition-all ${
                  isActive
                    ? "bg-white/10 border border-white/15 text-white shadow-sm"
                    : "border border-transparent hover:bg-zinc-900/60 hover:border-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Link
                  href={`/session/${s.id}`}
                  className="flex-1 flex items-start gap-2.5 p-2.5 overflow-hidden text-decoration-none"
                >
                  <MessageSquare
                    size={14}
                    className={`mt-0.5 shrink-0 ${
                      isActive
                        ? "text-white"
                        : "text-zinc-500 group-hover:text-zinc-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div
                      className={`text-xs truncate ${
                        isActive
                          ? "font-semibold text-white"
                          : "font-normal text-zinc-300 group-hover:text-white"
                      }`}
                    >
                      {s.title || s.id}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5">
                      <span>
                        {s.turnCount || 0} turn{s.turnCount === 1 ? "" : "s"}
                      </span>
                      <span>•</span>
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          s.status === "error"
                            ? "text-rose-400"
                            : s.status === "queued"
                              ? "text-sky-300"
                              : s.status === "running"
                                ? "text-amber-400"
                                : s.status === "awaiting_human"
                                  ? "text-amber-300"
                                  : "text-zinc-300"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            s.status === "queued"
                              ? "bg-sky-400 animate-pulse"
                              : s.status === "running"
                                ? "bg-amber-400 animate-pulse"
                                : s.status === "error"
                                  ? "bg-rose-400"
                                  : "bg-emerald-400"
                          }`}
                        />
                        {s.status}
                      </span>
                    </div>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await onDeleteSession(s.id);
                  }}
                  title="Delete Session"
                  className="opacity-0 group-hover:opacity-100 p-1.5 mr-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Navigation & Metrics Footer */}
      <div className="p-3 border-t border-white/8 space-y-1.5 bg-zinc-950">
        <Link
          href="/metrics"
          className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-white/8 hover:border-white/20 text-xs text-zinc-300 hover:text-white transition-all group"
        >
          <div className="flex items-center gap-2">
            <Activity
              size={14}
              className="text-zinc-400 group-hover:scale-110 transition-transform"
            />
            <span className="font-medium">Metrics & Tracing</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400 bg-white/5 border border-white/8 px-1.5 py-0.5 rounded">
            OTel
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setIsSetupOpen(true)}
          className="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-900/40 border border-white/5 hover:border-white/10 text-xs text-zinc-400 hover:text-zinc-200 transition-all"
        >
          <span className="flex items-center gap-2">
            <Settings size={14} className="text-zinc-400" />
            <span className="font-medium">Credentials & Setup</span>
          </span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono">
            Config
          </span>
        </button>
      </div>

      {/* Core Server Status */}
      <div className="px-4 py-2.5 border-t border-white/8 text-[11px] text-zinc-500 flex items-center justify-between bg-zinc-950 font-mono">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400/80 animate-pulse" />
          <span>Core Port: 4000</span>
        </div>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white transition-colors"
        >
          ⌘K
        </button>
      </div>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        commands={commands}
        placeholder="Search sessions and actions..."
      />

      <SetupWizard
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        onConfigSaved={({
          tenantId: nextTenantId,
          namespace: nextNamespace,
        }) => {
          onScopeChange?.({ tenantId: nextTenantId, namespace: nextNamespace });
        }}
      />
    </aside>
  );
}
