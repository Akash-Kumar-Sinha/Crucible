"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Terminal, BrainCircuit, Radio } from "lucide-react";
import type { ToolCall } from "@/api/orchestrator-client";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Message,
  MessageContent,
  MessageHeader,
  MessageAvatar,
} from "@/components/ui/message";
import {
  Progress,
  ProgressTrack,
  ProgressIndicator,
} from "@/components/ui/progress";

export interface LiveOutputProps {
  streamingThought?: string;
  streamingTokens?: string;
  activeToolCalls?: ToolCall[];
  toolStdout?: string;
  toolStderr?: string;
  _isConnected?: boolean;
  status?: "idle" | "queued" | "running" | "done" | "error" | "awaiting_human";
  agentState?:
    "awaiting_model" | "awaiting_tool" | "awaiting_human" | "done" | "error";
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

  React.useEffect(() => {
    const isOutputActive =
      Boolean(streamingTokens) || status === "done" || agentState === "done";

    if (isOutputActive && !prevOutputActiveRef.current) {
      setThoughtAccordionValue(null);
    } else if (
      !isOutputActive &&
      Boolean(streamingThought) &&
      prevOutputActiveRef.current
    ) {
      setThoughtAccordionValue("thinking");
    }

    prevOutputActiveRef.current = isOutputActive;
  }, [streamingThought, streamingTokens, status, agentState]);

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
      className="my-3.5 w-full"
    >
      <Message align="start" className="w-full">
        <MessageAvatar className="bg-zinc-900 border border-white/10 text-zinc-300">
          <Radio size={12} className="animate-pulse" />
        </MessageAvatar>

        <MessageContent className="items-start w-full">
          <MessageHeader className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            <span>Crucible Agent</span>
            <span className="rounded-md bg-zinc-800/80 border border-white/10 px-1.5 py-0.2 text-[10px] text-zinc-300">
              {agentStateLabel}
            </span>
          </MessageHeader>

          <div className="w-full max-w-[88%] sm:max-w-[82%] rounded-lg rounded-tl-sm p-4 sm:p-5 bg-zinc-900/80 border border-white/10 shadow-xl backdrop-blur-xl space-y-3">
            {isScalingUp && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-violet-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <div className="h-2 w-2 rounded-full bg-violet-300 animate-pulse" />
                  Scaling up
                </div>
                <p className="text-xs leading-relaxed text-violet-100/80">
                  Kubernetes is provisioning capacity for this tenant namespace.
                  The session is live, but the sandbox is waiting on a new node.
                </p>
                <Progress value={45} className="w-full">
                  <ProgressTrack className="h-1 bg-violet-950 rounded-full">
                    <ProgressIndicator className="h-1 bg-violet-400 rounded-full transition-all" />
                  </ProgressTrack>
                </Progress>
              </div>
            )}

            {/* Streaming Thought / Reasoning Box */}
            {streamingThought && (
              <Accordion
                value={thoughtAccordionValue}
                onValueChange={setThoughtAccordionValue}
                className="w-full"
              >
                <AccordionItem
                  value="thinking"
                  className="border border-white/10 bg-black rounded-lg"
                >
                  <AccordionTrigger
                    className="px-4 py-2.5 hover:bg-zinc-900/60 text-zinc-400"
                    chevronClassName="text-zinc-400 group-hover:text-zinc-300"
                  >
                    <div className="flex items-center gap-2">
                      <BrainCircuit
                        size={13}
                        className="animate-pulse text-zinc-400"
                      />
                      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                        Active Model Reasoning
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-white/5 px-4 py-3 text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
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
                      className="rounded-lg border border-white/8 bg-black p-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Terminal
                            size={13}
                            className="text-zinc-400 animate-spin"
                          />
                          <span className="font-mono text-xs font-semibold text-zinc-200">
                            Executing: {toolName}
                          </span>
                        </div>
                        {tc.id && (
                          <span className="text-[10px] font-mono text-zinc-500">
                            {tc.id}
                          </span>
                        )}
                      </div>
                      {hasArgs && (
                        <pre className="font-mono text-[11px] text-zinc-400 bg-zinc-950 p-2.5 mt-2.5 rounded-lg border border-white/5 overflow-x-auto">
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
              <Accordion defaultValue="terminal" className="w-full">
                <AccordionItem
                  value="terminal"
                  className="border border-white/10 bg-black rounded-lg"
                >
                  <AccordionTrigger
                    className="px-4 py-2.5 hover:bg-zinc-900/60 text-zinc-400"
                    chevronClassName="text-zinc-400 group-hover:text-zinc-300"
                  >
                    <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
                      <Terminal size={13} className="text-zinc-400" />
                      <span>SANDBOX PROCESS LOGS</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed max-h-60 overflow-y-auto font-mono text-zinc-400">
                    {toolStdout && (
                      <pre className="text-zinc-300 whitespace-pre-wrap">
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
              <div className="text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap">
                {streamingTokens}
                <span className="inline-block h-3.5 w-1.5 bg-zinc-300 ml-1 animate-pulse align-middle" />
                <div ref={tokensEndRef} />
              </div>
            )}
          </div>
        </MessageContent>
      </Message>
    </motion.section>
  );
}
