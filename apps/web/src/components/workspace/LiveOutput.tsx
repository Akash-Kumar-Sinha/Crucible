"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal, BrainCircuit, Radio, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
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

function CopyButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleCopy}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      title={copied ? "Copied" : "Copy"}
      className={cn(
        "inline-flex items-center justify-center h-7 w-7 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 select-none",
        copied && "text-emerald-400 hover:text-emerald-300 bg-emerald-500/10",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="copied"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
          >
            <Check size={14} className="text-emerald-400" />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
          >
            <Copy size={14} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

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
  const [thoughtOpen, setThoughtOpen] = React.useState(true);
  const [toolsOpen, setToolsOpen] = React.useState(true);
  const [terminalOpen, setTerminalOpen] = React.useState(true);

  const prevThoughtRef = React.useRef(streamingThought);
  const prevTokensRef = React.useRef(streamingTokens);
  const prevToolCallsCountRef = React.useRef(activeToolCalls.length);
  const prevLogsLenRef = React.useRef((toolStdout + toolStderr).length);

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

  // Independent auto-open while streaming & auto-close when finished for Thought
  React.useEffect(() => {
    if (
      streamingThought &&
      streamingThought !== prevThoughtRef.current &&
      !streamingTokens
    ) {
      setThoughtOpen(true);
    }
    if (
      (streamingTokens && !prevTokensRef.current) ||
      status === "done" ||
      agentState === "done"
    ) {
      setThoughtOpen(false);
    }
    prevThoughtRef.current = streamingThought;
    prevTokensRef.current = streamingTokens;
  }, [streamingThought, streamingTokens, status, agentState]);

  // Independent auto-open while streaming & auto-close when finished for Active Tools
  React.useEffect(() => {
    if (activeToolCalls.length > 0) {
      setToolsOpen(true);
    } else if (
      prevToolCallsCountRef.current > 0 &&
      activeToolCalls.length === 0
    ) {
      setToolsOpen(false);
    }
    prevToolCallsCountRef.current = activeToolCalls.length;
  }, [activeToolCalls]);

  // Independent auto-open while streaming & auto-close when finished for Process Logs
  React.useEffect(() => {
    const currentLogsLen = (toolStdout + toolStderr).length;
    if (currentLogsLen > 0 && currentLogsLen !== prevLogsLenRef.current) {
      setTerminalOpen(true);
    }
    if (status === "done" || agentState === "done") {
      setTerminalOpen(false);
    }
    prevLogsLenRef.current = currentLogsLen;
  }, [toolStdout, toolStderr, status, agentState]);

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

          <div className="w-full max-w-[88%] sm:max-w-[82%] p-4 sm:p-5">
            {isScalingUp && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-violet-200 space-y-2 mb-3">
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

            {/* 1. Streaming Thought / Reasoning Box inside Accordion */}
            {streamingThought && (
              <Accordion
                value={thoughtOpen ? ["thinking"] : []}
                onValueChange={(val) =>
                  setThoughtOpen(Array.isArray(val) && val.includes("thinking"))
                }
                className="w-full mb-3 rounded-lg border border-white/10 bg-black"
              >
                <AccordionItem value="thinking" className="border-none">
                  <AccordionTrigger className="px-4 py-2.5 hover:bg-zinc-900/60 text-zinc-400">
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

            {/* 2. Active Tool Call Executions inside Accordion */}
            {activeToolCalls.length > 0 && (
              <Accordion
                value={toolsOpen ? ["tools"] : []}
                onValueChange={(val) =>
                  setToolsOpen(Array.isArray(val) && val.includes("tools"))
                }
                className="w-full mb-3 rounded-lg border border-white/10 bg-black"
              >
                <AccordionItem value="tools" className="border-none">
                  <AccordionTrigger className="px-4 py-2.5 hover:bg-zinc-900/60 text-zinc-400">
                    <div className="flex items-center gap-2">
                      <Terminal
                        size={13}
                        className="text-zinc-400 animate-spin"
                      />
                      <span className="font-mono text-xs font-semibold text-zinc-200">
                        Tool Execution in Progress ({activeToolCalls.length})
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-white/5 p-3 space-y-2">
                    {activeToolCalls.map((tc, tcIndex) => {
                      const toolName = tc.name || tc.toolName || "tool";
                      const toolArgs = tc.arguments || tc.args || {};
                      const hasArgs =
                        typeof toolArgs === "object" &&
                        toolArgs !== null &&
                        Object.keys(toolArgs).length > 0;

                      return (
                        <div
                          key={
                            tc.id || tc.toolCallId || `${toolName}-${tcIndex}`
                          }
                          className="rounded-lg border border-white/8 bg-zinc-950 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-semibold text-zinc-200">
                              Executing: {toolName}
                            </span>
                            {tc.id && (
                              <span className="text-[10px] font-mono text-zinc-500">
                                ({tc.id})
                              </span>
                            )}
                          </div>
                          {hasArgs && (
                            <pre className="font-mono text-[11px] text-zinc-400 bg-black p-2.5 mt-2 rounded-lg border border-white/5 overflow-x-auto">
                              {JSON.stringify(toolArgs, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {/* 3. Live Terminal Stdout & Stderr Output inside Accordion */}
            {(toolStdout || toolStderr) && (
              <Accordion
                value={terminalOpen ? ["terminal"] : []}
                onValueChange={(val) =>
                  setTerminalOpen(
                    Array.isArray(val) && val.includes("terminal"),
                  )
                }
                className="w-full mb-3 rounded-lg border border-white/10 bg-black"
              >
                <AccordionItem value="terminal" className="border-none">
                  <AccordionTrigger className="px-4 py-2.5 text-zinc-400 hover:bg-zinc-900/60">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
                      <Terminal size={13} className="text-zinc-400" />
                      <span>SANDBOX PROCESS LOGS</span>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="max-h-60 overflow-y-auto border-t border-white/5 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-400">
                    {toolStdout && (
                      <pre className="whitespace-pre-wrap text-zinc-300">
                        {toolStdout}
                      </pre>
                    )}

                    {toolStderr && (
                      <pre className="mt-2 whitespace-pre-wrap text-rose-400">
                        {toolStderr}
                      </pre>
                    )}

                    <div ref={terminalEndRef} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {/* 4. Live Token Streaming Output (The actual message) */}
            {streamingTokens && (
              <div>
                <div className="text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap">
                  {streamingTokens}
                  <span className="inline-block h-3.5 w-1.5 bg-zinc-300 ml-1 animate-pulse align-middle" />
                  <div ref={tokensEndRef} />
                </div>
                <div className="flex items-center justify-start gap-1 mt-2">
                  <CopyButton text={streamingTokens} />
                </div>
              </div>
            )}
          </div>
        </MessageContent>
      </Message>
    </motion.section>
  );
}
