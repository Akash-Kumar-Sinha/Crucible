"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Terminal,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Radio,
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
      className="my-4 overflow-hidden rounded-lg
 border border-white/10 bg-zinc-900/80 shadow-2xl backdrop-blur-xl"
    >
      {/* Stream Status Header */}
      <header className="flex items-center justify-between border-b border-white/8 bg-zinc-950/70 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-500">
            <Radio size={13} className="animate-pulse" />
            <span>CRUCIBLE LIVE STREAM</span>
          </div>
          <span className="text-zinc-600">|</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              status === "running"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                : status === "awaiting_human"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : status === "error"
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    : "bg-primary/10 text-primary border border-primary/20"
            }`}
          >
            {status}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          <span>SSE Channel</span>
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-primary" : "bg-amber-400"
            }`}
          />
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* Streaming Thought / Reasoning Box */}
        {streamingThought && (
          <div className="overflow-hidden rounded-lg border border-amber-500/20 bg-amber-950/10">
            <button
              type="button"
              onClick={() => setThoughtExpanded(!thoughtExpanded)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <BrainCircuit size={14} />
                <span>ACTIVE MODEL REASONING</span>
              </div>
              {thoughtExpanded ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>

            <AnimatePresence>
              {thoughtExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="border-t border-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90 whitespace-pre-wrap leading-relaxed">
                    {streamingThought}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Active Tool Call Executions */}
        {activeToolCalls.length > 0 && (
          <div className="space-y-2">
            {activeToolCalls.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-primary animate-spin" />
                  <span className="font-mono font-medium text-primary">
                    Executing Tool: {tc.name}
                  </span>
                </div>
                <span className="text-[10px] text-primary/70">{tc.id}</span>
              </div>
            ))}
          </div>
        )}

        {/* Live Terminal Stdout & Stderr Output */}
        {(toolStdout || toolStderr) && (
          <div className="overflow-hidden rounded-lg border border-white/8 bg-zinc-950/90">
            <button
              type="button"
              onClick={() => setTerminalExpanded(!terminalExpanded)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <Terminal size={14} className="text-primary" />
                <span>SANDBOX PROCESS OUTPUT (STDOUT / STDERR)</span>
              </div>
              {terminalExpanded ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>

            <AnimatePresence>
              {terminalExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="border-t border-white/5 p-3 text-xs leading-relaxed max-h-56 overflow-y-auto">
                    {toolStdout && (
                      <pre className="text-zinc-200 whitespace-pre-wrap">
                        {toolStdout}
                      </pre>
                    )}
                    {toolStderr && (
                      <pre className="text-rose-400/90 whitespace-pre-wrap mt-2">
                        {toolStderr}
                      </pre>
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Live Token Streaming Output */}
        {streamingTokens && (
          <div className="rounded-lg border border-white/8 bg-zinc-950/70 p-3.5 text-sm leading-relaxed text-zinc-200">
            <div className="flex items-center gap-2 mb-1.5 text-xs text-primary/80">
              <span>Token Stream</span>
            </div>
            <div className="whitespace-pre-wrap font-sans">
              {streamingTokens}
              <span className="inline-block h-3.5 w-1.5 bg-primary ml-1 animate-pulse" />
            </div>
            <div ref={tokensEndRef} />
          </div>
        )}
      </div>
    </motion.section>
  );
}
