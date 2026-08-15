"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Terminal, BrainCircuit, Radio } from "lucide-react";
import type { ToolCall } from "../api/orchestrator-client";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

export interface LiveOutputProps {
  streamingThought?: string;
  streamingTokens?: string;
  activeToolCalls?: ToolCall[];
  toolStdout?: string;
  toolStderr?: string;
  _isConnected?: boolean;
  status?: "idle" | "queued" | "running" | "done" | "error" | "awaiting_human";
  agentState?:
    | "awaiting_model"
    | "awaiting_tool"
    | "awaiting_human"
    | "done"
    | "error";
}

export function LiveOutput({
  streamingThought = "",
  streamingTokens = "",
  activeToolCalls = [],
  toolStdout = "",
  toolStderr = "",
  _isConnected = true,
  status = "idle",
  agentState = "awaiting_model",
}: LiveOutputProps) {
  const [thoughtAccordionValue, setThoughtAccordionValue] = React.useState<
    string | null
  >("thinking");
  const prevOutputActiveRef = React.useRef(false);
  const terminalEndRef = React.useRef<HTMLDivElement>(null);
  const tokensEndRef = React.useRef<HTMLDivElement>(null);

  const isScalingUp =
    status === "running" &&
    !_isConnected &&
    !streamingThought &&
    !streamingTokens &&
    activeToolCalls.length === 0 &&
    !toolStdout &&
    !toolStderr;
  // Automatically keep thinking accordion open while model is thinking,
  // and automatically close it once output is finalized or starts streaming tokens
  React.useEffect(() => {
    const isOutputActive =
      Boolean(streamingTokens) || status === "done" || agentState === "done";

    if (isOutputActive && !prevOutputActiveRef.current) {
      // Output started / finalized -> auto-close thinking accordion
      setThoughtAccordionValue(null);
    } else if (
      !isOutputActive &&
      Boolean(streamingThought) &&
      prevOutputActiveRef.current
    ) {
      // New reasoning cycle started -> auto-open thinking accordion
      setThoughtAccordionValue("thinking");
    }

    prevOutputActiveRef.current = isOutputActive;
  }, [streamingThought, streamingTokens, status, agentState]);

  // Auto-scroll token stream
  React.useEffect(() => {
    tokensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingTokens]);

  const hasContent =
    Boolean(streamingThought) ||
    Boolean(streamingTokens) ||
    Boolean(toolStdout) ||
    Boolean(toolStderr) ||
    activeToolCalls.length > 0;

  if (!hasContent && status !== "running" && status !== "queued") {
    return null;
  }

  const agentStateLabel = isScalingUp
    ? "Scaling Up"
    : status === "queued"
      ? "Queued"
      : agentState === "awaiting_tool"
        ? "Executing Sandbox Tools"
        : agentState === "awaiting_human"
          ? "Awaiting Human Review"
          : agentState === "done"
            ? "Execution Complete"
            : agentState === "error"
              ? "Execution Failed"
              : "Generating Reasoning & Plan";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      aria-label="Real-time Execution Stream"
      className="my-3.5 flex flex-col gap-1.5 items-start"
    >
      {/* Sender Header with Live Pulse */}
      <div className="flex items-center gap-2 px-1 text-xs font-medium text-zinc-400">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 border border-white/10 text-zinc-300">
          <Radio size={11} className="animate-pulse" />
        </div>
        <span className="text-[11px] font-semibold text-zinc-200">
          Crucible Agent
        </span>
        <span className="rounded-md bg-zinc-800 border border-white/10 px-1.5 py-0.2 text-[10px] font-mono text-zinc-300">
          {agentStateLabel}
        </span>
      </div>

      {/* Main Streaming Glass Container */}
      <div className="w-full max-w-[88%] sm:max-w-[82%] rounded-2xl rounded-tl-sm p-4 sm:p-5 bg-zinc-900/70 border border-white/10 shadow-xl backdrop-blur-xl space-y-3">
        {isScalingUp && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-200">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
              <div className="h-2 w-2 rounded-full bg-amber-300 animate-pulse" />
              Scaling up
            </div>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
              Kubernetes is provisioning capacity for this tenant namespace. The
              session is live, but the sandbox is waiting on a new node.
            </p>
          </div>
        )}
        {/* Streaming Thought / Reasoning Box using builtin Accordion */}
        {streamingThought && (
          <Accordion
            value={thoughtAccordionValue}
            onValueChange={setThoughtAccordionValue}
            className="w-full "
          >
            <AccordionItem
              value="thinking"
              className="border border-white/10 bg-black rounded-xl"
            >
              <AccordionTrigger
                className="px-4 py-2.5 hover:bg-zinc-900/60 text-neutral-400"
                chevronClassName="text-neutral-400 group-hover:text-neutral-300"
              >
                <div className="flex items-center gap-2">
                  <BrainCircuit
                    size={13}
                    className="animate-pulse text-neutral-400"
                  />
                  <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                    Active Model Reasoning
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/5 px-4 py-3 text-xs text-neutral-400 whitespace-pre-wrap leading-relaxed ">
                {streamingThought}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* Active Tool Call Executions */}
        {activeToolCalls.length > 0 && (
          <div className="space-y-2">
            {activeToolCalls.map((tc, tcIndex) => {
              const toolName = tc.name || tc.toolName || "tool";
              const toolArgs = tc.arguments || tc.args || {};
              const hasArgs =
                typeof toolArgs === "object" &&
                toolArgs !== null &&
                Object.keys(toolArgs).length > 0;

              return (
                <div
                  key={tc.id || tc.toolCallId || `${toolName}-${tcIndex}`}
                  className="rounded-xl border border-white/8 bg-black p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal
                        size={13}
                        className="text-neutral-400 animate-spin"
                      />
                      <span className="font-mono text-xs font-semibold text-neutral-200">
                        Executing: {toolName}
                      </span>
                    </div>
                    {tc.id && (
                      <span className="text-[10px] font-mono text-neutral-500">
                        {tc.id}
                      </span>
                    )}
                  </div>
                  {hasArgs && (
                    <pre className="font-mono text-[11px] text-neutral-400 bg-zinc-950 p-2.5 mt-2.5 rounded-lg border border-white/5 overflow-x-auto">
                      {JSON.stringify(toolArgs, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Live Terminal Stdout & Stderr Output */}
        {(toolStdout || toolStderr) && (
          <Accordion defaultValue="terminal" className="w-full ">
            <AccordionItem
              value="terminal"
              className="border border-white/10 bg-black rounded-xl"
            >
              <AccordionTrigger
                className="px-4 py-2.5 hover:bg-zinc-900/60 text-neutral-400"
                chevronClassName="text-neutral-400 group-hover:text-neutral-300"
              >
                <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
                  <Terminal size={13} className="text-neutral-400" />
                  <span>SANDBOX PROCESS LOGS</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed max-h-60 overflow-y-auto font-mono text-neutral-400">
                {toolStdout && (
                  <pre className="text-neutral-300 whitespace-pre-wrap">
                    {toolStdout}
                  </pre>
                )}
                {toolStderr && (
                  <pre className="text-rose-400 whitespace-pre-wrap mt-2">
                    {toolStderr}
                  </pre>
                )}
                <div ref={terminalEndRef} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* Live Token Streaming Output */}
        {streamingTokens && (
          <div className="text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap ">
            {streamingTokens}
            <span className="inline-block h-3.5 w-1.5 bg-zinc-300 ml-1 animate-pulse align-middle" />
            <div ref={tokensEndRef} />
          </div>
        )}
      </div>
    </motion.section>
  );
}
