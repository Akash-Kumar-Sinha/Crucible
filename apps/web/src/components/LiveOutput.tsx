"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Terminal,
  BrainCircuit,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Radio,
  Cpu,
} from "lucide-react";
import type { ToolCall } from "../api/orchestrator-client";

export interface LiveOutputProps {
  streamingThought?: string;
  streamingTokens?: string;
  activeToolCalls?: ToolCall[];
  toolStdout?: string;
  toolStderr?: string;
  isConnected?: boolean;
  status?: "idle" | "running" | "done" | "error" | "awaiting_human";
}

export function LiveOutput({
  streamingThought = "",
  streamingTokens = "",
  activeToolCalls = [],
  toolStdout = "",
  toolStderr = "",
  isConnected = true,
  status = "idle",
}: LiveOutputProps) {
  const [thoughtExpanded, setThoughtExpanded] = React.useState(true);
  const [terminalExpanded, setTerminalExpanded] = React.useState(true);
  const terminalEndRef = React.useRef<HTMLDivElement>(null);
  const tokensEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll terminal and token stream
  React.useEffect(() => {
    if (terminalExpanded) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [toolStdout, toolStderr, terminalExpanded]);

  React.useEffect(() => {
    tokensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingTokens]);

  const hasContent =
    Boolean(streamingThought) ||
    Boolean(streamingTokens) ||
    Boolean(toolStdout) ||
    Boolean(toolStderr) ||
    activeToolCalls.length > 0;

  if (!hasContent && status !== "running") {
    return null;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
      aria-label="Real-time Execution Stream"
      style={{
        margin: "12px 0 16px",
        borderRadius: "10px",
        background: "#0d0d10",
        border: "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "0",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Stream Status Header */}
      <header
        style={{
          padding: "8px 14px",
          background: "#121216",
          borderBottom: "1px solid #1f1f23",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              color: isConnected ? "#22c55e" : "#eab308",
              fontWeight: 600,
            }}
          >
            <Radio
              size={13}
              className={status === "running" ? "animate-pulse" : ""}
            />
            <span>{isConnected ? "LIVE STREAM" : "RECONNECTING"}</span>
          </div>

          {activeToolCalls.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "4px",
                background: "#1e1e24",
                color: "#60a5fa",
                fontSize: "11px",
              }}
            >
              <Cpu size={11} />
              <span>
                Executing:{" "}
                {activeToolCalls.map((t) => t.toolName || t.name).join(", ")}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", color: "#71717a" }}>
            Status: <b style={{ color: "#e4e4e7" }}>{status}</b>
          </span>
        </div>
      </header>

      {/* Streaming Thought / Reasoning Box */}
      {streamingThought && (
        <div
          style={{
            borderBottom: "1px solid #1f1f23",
            background: "rgba(24, 24, 27, 0.4)",
          }}
        >
          <button
            type="button"
            onClick={() => setThoughtExpanded(!thoughtExpanded)}
            style={{
              width: "100%",
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#a1a1aa",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <BrainCircuit size={14} color="#a855f7" />
              <span style={{ color: "#e9d5ff" }}>
                Model Reasoning & Thoughts
              </span>
            </div>
            {thoughtExpanded ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>

          <AnimatePresence initial={false}>
            {thoughtExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: "hidden" }}
              >
                <div
                  style={{
                    padding: "0 14px 12px",
                    fontSize: "12px",
                    color: "#d4d4d8",
                    lineHeight: 1.6,
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                    borderLeft: "2px solid #9333ea",
                    marginLeft: "14px",
                    marginBottom: "8px",
                  }}
                >
                  {streamingThought}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Streaming Tokens Stream Window */}
      {streamingTokens && (
        <div
          style={{
            padding: "12px 14px",
            borderBottom:
              toolStdout || toolStderr ? "1px solid #1f1f23" : "none",
            fontSize: "13px",
            lineHeight: 1.6,
            color: "#f4f4f5",
            whiteSpace: "pre-wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "6px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#a1a1aa",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <Sparkles size={12} color="#38bdf8" />
            <span>Streaming Output</span>
          </div>
          <div>
            {streamingTokens}
            {status === "running" && (
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "13px",
                  background: "#38bdf8",
                  marginLeft: "3px",
                  verticalAlign: "middle",
                }}
              />
            )}
          </div>
          <div ref={tokensEndRef} />
        </div>
      )}

      {/* Live Tool Terminal Output */}
      {(toolStdout || toolStderr) && (
        <div>
          <button
            type="button"
            onClick={() => setTerminalExpanded(!terminalExpanded)}
            style={{
              width: "100%",
              padding: "7px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#09090b",
              border: "none",
              cursor: "pointer",
              color: "#a1a1aa",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Terminal size={12} color="#22c55e" />
              <span>Tool Execution Logs (Stdout / Stderr)</span>
            </div>
            {terminalExpanded ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
          </button>

          <AnimatePresence initial={false}>
            {terminalExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: "hidden" }}
              >
                <pre
                  style={{
                    margin: "0",
                    padding: "10px 14px",
                    background: "#000000",
                    color: "#a1a1aa",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: "11px",
                    lineHeight: 1.5,
                    maxHeight: "180px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {toolStdout && (
                    <span style={{ color: "#22c55e" }}>{toolStdout}</span>
                  )}
                  {toolStderr && (
                    <span style={{ color: "#ef4444" }}>{toolStderr}</span>
                  )}
                  <div ref={terminalEndRef} />
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  );
}
