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
} from "lucide-react";
import Link from "next/link";

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
  const [creating, setCreating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

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
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <motion.div
            whileHover={{ rotate: 15 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              background: "#18181b",
              border: "1px solid #27272a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Cpu size={16} color="#f4f4f5" />
          </motion.div>
          <div>
            <h1
              style={{
                fontSize: "14px",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#f4f4f5",
              }}
            >
              CRUCIBLE
            </h1>
            <p style={{ fontSize: "11px", color: "#71717a" }}>
              Reasoning Orchestrator
            </p>
          </div>
        </div>
      </div>

      {/* New Session Action Button */}
      <div style={{ padding: "14px 16px" }}>
        <motion.button
          onClick={handleCreate}
          disabled={creating}
          whileHover={{ scale: creating ? 1 : 1.02 }}
          whileTap={{ scale: creating ? 1 : 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: creating ? "#27272a" : "#ffffff",
            color: creating ? "#a1a1aa" : "#09090b",
            border: "none",
            borderRadius: "7px",
            padding: "9px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: creating ? "not-allowed" : "pointer",
            boxShadow: creating ? "none" : "0 2px 8px rgba(255, 255, 255, 0.1)",
            transition: "background 0.2s ease, color 0.2s ease",
          }}
        >
          {creating ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              style={{ display: "flex", alignItems: "center" }}
            >
              <Loader2 size={15} />
            </motion.div>
          ) : (
            <Plus size={15} />
          )}
          <span>{creating ? "Creating Session..." : "New Session"}</span>
        </motion.button>
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
                  background: isActive ? "#18181b" : "transparent",
                  border: isActive
                    ? "1px solid #3f3f46"
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
                    color: isActive ? "#f4f4f5" : "#a1a1aa",
                    fontSize: "13px",
                    overflow: "hidden",
                  }}
                >
                  <MessageSquare
                    size={15}
                    color={isActive ? "#ffffff" : "#71717a"}
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

      {/* System Status Footer */}
      <div
        style={{
          padding: "14px 16px",
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
        <Activity size={13} />
      </div>
    </aside>
  );
}
