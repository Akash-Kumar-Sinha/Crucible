"use client";

import * as React from "react";
import type { AgentMessage } from "../api/orchestrator-client";
import { motion, AnimatePresence } from "motion/react";
import {
  Terminal,
  Brain,
  CheckCircle2,
  ChevronDown,
  User,
  Bot,
  AlertTriangle,
  Clock,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";

interface MessageBubbleProps {
  message: AgentMessage;
  index?: number;
}

export function MessageBubble({ message, index = 0 }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isAssistant = message.role === "assistant";
  const [thoughtOpen, setThoughtOpen] = React.useState(false);

  // Extract thought if embedded in XML tags
  let thoughtText = message.thought || "";
  let cleanContent = message.content || "";

  if (cleanContent.includes("<thought>")) {
    const match = cleanContent.match(/<thought>([\s\S]*?)<\/thought>/);
    if (match) {
      thoughtText = match[1].trim();
      cleanContent = cleanContent
        .replace(/<thought>[\s\S]*?<\/thought>/, "")
        .trim();
    }
  }

  const isErrorMessage =
    cleanContent.startsWith("⚠️") || cleanContent.includes("Execution Error");

  if (isTool) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="my-3 pl-8 sm:pl-10"
      >
        <div className="rounded-lg border border-white/8 bg-zinc-900/60 p-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Observation {message.name ? `• ${message.name}` : ""}
            </span>
          </div>
          <pre className="rounded-xl border border-white/5 bg-zinc-950/80 p-3 text-xs leading-relaxed text-zinc-200 overflow-x-auto">
            {cleanContent}
          </pre>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
        delay: Math.min(index * 0.03, 0.15),
      }}
      className={`my-3 flex flex-col gap-1.5 ${
        isUser ? "items-end" : "items-start"
      }`}
    >
      {/* Sender Header */}
      <div className="flex items-center gap-2 px-1 text-xs font-medium text-zinc-400">
        {isUser ? (
          <>
            <span>You</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 border border-white/10 text-zinc-200">
              <User size={12} />
            </div>
          </>
        ) : (
          <>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 border border-primary/20 text-primary">
              <Bot size={12} />
            </div>
            <span className="font-semibold text-zinc-300">Crucible Agent</span>
          </>
        )}
      </div>

      {/* Message Card Container */}
      <div
        className={`max-w-[85%] rounded-lg p-5 shadow-xl transition-all ${
          isUser
            ? "bg-primary/10 border border-primary/25 text-white rounded-tr-sm"
            : isErrorMessage
              ? "bg-rose-950/20 border border-rose-500/30 text-rose-200 rounded-tl-sm"
              : "bg-zinc-900/70 border border-white/8 text-zinc-100 rounded-tl-sm backdrop-blur-md"
        }`}
      >
        {/* Expandable Reasoning / Thought process */}
        {thoughtText ? (
          <div className="mb-3 overflow-hidden rounded-lg border border-white/8 bg-zinc-950/60">
            <button
              type="button"
              onClick={() => setThoughtOpen(!thoughtOpen)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Brain size={14} className="text-amber-400" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">
                  Reasoning Process
                </span>
              </div>
              <motion.div
                animate={{ rotate: thoughtOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown size={14} />
              </motion.div>
            </button>

            <AnimatePresence>
              {thoughtOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-white/5 px-3.5 py-3 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
                    {thoughtText}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}

        {/* Formatted Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="rounded-lg border border-white/8 bg-zinc-950/60 p-3.5"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Terminal size={13} className="text-primary" />
                  <span className="font-mono text-xs font-semibold text-primary">
                    Action: {tc.name}
                  </span>
                </div>
                <pre className="font-mono text-[11px] text-zinc-300 overflow-x-auto leading-relaxed">
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}

        {/* Message Content */}
        {cleanContent ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {cleanContent}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
