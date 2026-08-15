"use client";

import * as React from "react";
import type { AgentMessage } from "../api/orchestrator-client";
import { motion } from "motion/react";
import { Terminal, CheckCircle2, User, Bot } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  message: AgentMessage;
  index?: number;
}

export function MessageBubble({ message, index = 0 }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const [thoughtAccordionValue, setThoughtAccordionValue] = React.useState<
    string | null
  >(null);

  // Extract thought if embedded in XML tags
  let thoughtText = message.thought || "";
  let cleanContent = message.content || "";

  if (cleanContent.includes("<thought>") || cleanContent.includes("<think>")) {
    const thoughtMatch = cleanContent.match(/<thought>([\s\S]*?)<\/thought>/i);
    const thinkMatch = cleanContent.match(/<think>([\s\S]*?)<\/think>/i);
    const matched = thoughtMatch || thinkMatch;
    if (matched) {
      thoughtText =
        (thoughtText ? `${thoughtText}\n\n` : "") + matched[1].trim();
      cleanContent = cleanContent
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .trim();
    }
  }

  const isErrorMessage =
    message.role === "assistant" &&
    (cleanContent.toLowerCase().includes("error:") ||
      cleanContent.toLowerCase().includes("fatal:"));

  if (isTool) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="my-3 pl-8 sm:pl-10"
      >
        <div className="rounded-xl border border-white/8 bg-black p-3.5 shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-neutral-400" />
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
                Observation {message.name ? `• ${message.name}` : ""}
              </span>
            </div>
            {message.toolCallId && (
              <span className="text-[10px] font-mono text-neutral-500">
                {message.toolCallId}
              </span>
            )}
          </div>
          <pre className="rounded-lg border border-white/5 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-neutral-300 overflow-x-auto whitespace-pre-wrap max-h-72">
            {cleanContent}
          </pre>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
        delay: Math.min(index * 0.02, 0.12),
      }}
      className={`my-3.5 flex flex-col gap-1.5 ${
        isUser ? "items-end" : "items-start"
      }`}
    >
      {/* Sender Header */}
      <div className="flex items-center gap-2 px-1 text-xs font-medium text-zinc-400">
        {isUser ? (
          <>
            <span className="text-[11px] text-zinc-400 font-medium">You</span>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 border border-white/10 text-zinc-300">
              <User size={11} />
            </div>
          </>
        ) : (
          <>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 border border-white/10 text-zinc-300">
              <Bot size={11} />
            </div>
            <span className="text-[11px] font-semibold text-zinc-300">
              Crucible Agent
            </span>
          </>
        )}
      </div>

      {/* Message Card Container */}
      <div
        className={`max-w-[88%] sm:max-w-[82%] rounded-2xl p-4 sm:p-5 shadow-lg transition-all ${
          isUser
            ? "bg-zinc-900 border border-white/10 text-white rounded-tr-sm"
            : isErrorMessage
              ? "bg-rose-950/20 border border-rose-500/30 text-rose-200 rounded-tl-sm backdrop-blur-md"
              : "bg-zinc-900/60 border border-white/8 text-zinc-100 rounded-tl-sm backdrop-blur-md"
        }`}
      >
        {/* Expandable Reasoning / Thought process using builtin Accordion */}
        {thoughtText ? (
          <Accordion
            value={thoughtAccordionValue}
            onValueChange={setThoughtAccordionValue}
            className="mb-3.5 "
          >
            <AccordionItem
              value="thought"
              className="border border-white/10 bg-black rounded-xl"
            >
              <AccordionTrigger
                className="p-4 hover:bg-zinc-900/60 text-neutral-400"
                chevronClassName="text-neutral-400 group-hover:text-neutral-300"
              >
                <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  Model Reasoning
                </span>
              </AccordionTrigger>
              <AccordionContent className="p-4 text-xs leading-relaxed text-neutral-400 whitespace-pre-wrap ">
                {thoughtText}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}

        {/* Formatted Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="mb-3.5 flex flex-col gap-2">
            {message.toolCalls.map((tc, tcIndex) => {
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Terminal size={13} className="text-neutral-400" />
                      <span className="font-mono text-xs font-semibold text-neutral-200">
                        Action: {toolName}
                      </span>
                    </div>
                    {tc.id && (
                      <span className="font-mono text-[10px] text-neutral-500">
                        {tc.id}
                      </span>
                    )}
                  </div>
                  {hasArgs && (
                    <pre className="font-mono text-[11px] text-neutral-400 overflow-x-auto leading-relaxed bg-zinc-950 p-2.5 mt-2.5 rounded-lg border border-white/5">
                      {JSON.stringify(toolArgs, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Message Content */}
        {cleanContent ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white ">
              {cleanContent}
            </div>
          ) : (
            <MarkdownRenderer content={cleanContent} />
          )
        ) : null}
      </div>
    </motion.div>
  );
}
