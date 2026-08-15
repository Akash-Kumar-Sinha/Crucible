"use client";

import * as React from "react";
import type { SessionSummary } from "../api/orchestrator-client";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  MessageSquare,
  Trash2,
  Cpu,
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
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onCreateSession,
  onDeleteSession,
  loading = false,
}: SessionSidebarProps) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSetupOpen, setIsSetupOpen] = React.useState(false);
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
    <aside
      style={{
        width: "280px",
        minWidth: "280px",
        background: "#0d0d10",
        borderRight: "1px solid #27272a",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        userSelect: "none",
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: "18px 16px",
          borderBottom: "1px solid #27272a",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo className="w-7 h-7 text-primary transition-transform group-hover:scale-105" />
          <div className="flex flex-col">
            <CrucibleWordmark className="text-2xl text-white group-hover:text-primary transition-colors leading-none" />
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Reasoning Harness
            </p>
          </div>
        </Link>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full"
        >
          {creating ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          {creating ? "Creating Session..." : "New Session"}
        </Button>
      </div>

      {/* Inline Error Notice */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              margin: "0 16px 10px",
              padding: "10px",
              borderRadius: "6px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              fontSize: "12px",
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              lineHeight: 1.4,
            }}
          >
            <AlertCircle
              size={14}
              style={{ flexShrink: 0, marginTop: "2px" }}
            />
            <div style={{ flex: 1 }}>{errorMessage}</div>
            <button
              onClick={() => setErrorMessage(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#f87171",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
              }}
              title="Dismiss error"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "6px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#71717a",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "6px 8px",
          }}
        >
          Active Sessions ({sessions.length})
        </div>

        {sessions.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "#71717a",
              fontSize: "12px",
            }}
          >
            No active sessions. Click &ldquo;New Session&rdquo; to start.
          </div>
        ) : (
          sessions.map((s, idx) => {
            const isActive = s.id === activeSessionId;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: Math.min(idx * 0.03, 0.2),
                  duration: 0.2,
                }}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: "6px",
                  background: isActive
                    ? "rgba(59, 130, 246, 0.08)"
                    : "transparent",
                  border: isActive
                    ? "1px solid rgba(59, 130, 246, 0.25)"
                    : "1px solid transparent",
                  transition: "background 0.15s ease, border 0.15s ease",
                }}
              >
                <Link
                  href={`/session/${s.id}`}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "9px 10px",
                    textDecoration: "none",
                    color: isActive ? "#ffffff" : "#a1a1aa",
                    fontSize: "13px",
                    overflow: "hidden",
                  }}
                >
                  <MessageSquare
                    size={15}
                    color={isActive ? "#3b82f6" : "#71717a"}
                    style={{ flexShrink: 0 }}
                  />
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: isActive ? 600 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.title || s.id}
                    </div>
                    <div style={{ fontSize: "11px", color: "#71717a" }}>
                      {s.turnCount || 0} turn{s.turnCount === 1 ? "" : "s"} •{" "}
                      <span
                        style={{
                          color:
                            s.status === "error"
                              ? "#ef4444"
                              : s.status === "running"
                                ? "#eab308"
                                : "#22c55e",
                        }}
                      >
                        {s.status}
                      </span>
                    </div>
                  </div>
                </Link>

                <motion.button
                  whileHover={{ scale: 1.15, color: "#f87171" }}
                  whileTap={{ scale: 0.9 }}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await onDeleteSession(s.id);
                  }}
                  title="Delete Session"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "8px",
                    cursor: "pointer",
                    color: "#71717a",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: "4px",
                  }}
                >
                  <Trash2 size={13} />
                </motion.button>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Metrics & Setup Navigation */}
      <div
        style={{
          padding: "8px 16px",
          borderTop: "1px solid #27272a",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <Link
          href="/metrics"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            background: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#e4e4e7",
            textDecoration: "none",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={14} color="#10b981" />
            <span style={{ fontWeight: 500 }}>Metrics & Tracing</span>
          </div>
          <span
            style={{
              fontSize: "10px",
              fontFamily: "monospace",
              color: "#a1a1aa",
              background: "#27272a",
              padding: "2px 5px",
              borderRadius: "4px",
            }}
          >
            OTel
          </span>
        </Link>

        <Button
          type="button"
          variant="secondary"
          className="h-auto w-full justify-between px-3 py-2"
          onClick={() => setIsSetupOpen(true)}
        >
          <span className="flex items-center gap-2">
            <Settings size={14} className="text-white/60" />
            <span className="font-medium">Setup & Credentials</span>
          </span>
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
            Config
          </span>
        </Button>
      </div>

      {/* System Status Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #27272a",
          fontSize: "11px",
          color: "#71717a",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <motion.div
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#22c55e",
            }}
          />
          <span>Core Server: Port 4000</span>
        </div>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="rounded-lg border border-white/8 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:text-white/70"
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

      <SetupWizard isOpen={isSetupOpen} onClose={() => setIsSetupOpen(false)} />
    </aside>
  );
}
