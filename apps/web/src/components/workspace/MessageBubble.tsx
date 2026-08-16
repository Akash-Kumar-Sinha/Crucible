"use client";

import * as React from "react";
import type { AgentMessage } from "@/api/orchestrator-client";
import { motion } from "motion/react";
import { Terminal, CheckCircle2, User, Bot, Send } from "lucide-react";
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
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { MarkdownRenderer } from "@/components/workspace/MarkdownRenderer";

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

  const isInterSession =
    cleanContent.startsWith("[Inter-Session Message from") ||
    (message.role === "system" &&
      cleanContent.includes("Inter-Session Message"));

  if (isInterSession) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="my-3 w-full"
      >
        <Marker
          variant="separator"
          className="mb-2 text-violet-400 font-mono text-[11px]"
        >
          <MarkerIcon>
            <Send size={12} className="text-violet-400" />
          </MarkerIcon>
          <MarkerContent>Inter-Session Message Received</MarkerContent>
        </Marker>

        <div className="rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-zinc-300 font-mono leading-relaxed shadow-sm">
          {cleanContent}
        </div>
      </motion.div>
    );
  }

  if (isTool) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="my-3 w-full"
      >
        <Marker
          variant="separator"
          className="mb-2 text-zinc-500 font-mono text-[11px]"
        >
          <MarkerIcon>
            <CheckCircle2 size={12} className="text-zinc-400" />
          </MarkerIcon>
          <MarkerContent>
            Observation {message.name ? `• ${message.name}` : ""}
          </MarkerContent>
        </Marker>

        <Accordion defaultValue="obs" className="w-full">
          <AccordionItem
            value="obs"
            className="rounded-lg border border-white/8 bg-black/80 shadow-md"
          >
            <AccordionTrigger className="p-3 hover:bg-zinc-900/60 text-zinc-400">
              <div className="flex items-center gap-2">
                <Terminal size={12} className="text-zinc-400" />
                <span className="font-mono text-[11px] text-zinc-300">
                  {message.name
                    ? `Output from ${message.name}`
                    : "Tool Execution Logs"}
                </span>
                {message.toolCallId && (
                  <span className="font-mono text-[10px] text-zinc-500">
                    ({message.toolCallId})
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-3 pt-0">
              <pre className="rounded-lg border border-white/5 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-72">
                {cleanContent}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
      className="w-full my-2.5"
    >
      <Message align={isUser ? "end" : "start"} className="w-full">
        <MessageAvatar
          className={
            isUser
              ? "bg-zinc-800 border border-white/10 text-zinc-200"
              : "bg-zinc-900 border border-white/10 text-zinc-300"
          }
        >
          {isUser ? <User size={13} /> : <Bot size={13} />}
        </MessageAvatar>

        <MessageContent className={isUser ? "items-end" : "items-start"}>
          <MessageHeader className="text-[11px] font-mono text-zinc-400">
            {isUser ? "You" : "Crucible Agent"}
          </MessageHeader>

          <div
            className={`max-w-[88%] sm:max-w-[82%] rounded-lg p-4 sm:p-5 shadow-lg transition-all ${
              isUser
                ? "bg-zinc-800 border border-white/10 text-white rounded-tr-sm"
                : isErrorMessage
                  ? "bg-rose-950/20 border border-rose-500/30 text-rose-200 rounded-tl-sm backdrop-blur-md"
                  : "bg-zinc-900/80 border border-white/8 text-zinc-100 rounded-tl-sm backdrop-blur-md"
            }`}
          >
            {/* Expandable Reasoning / Thought process using builtin Accordion */}
            {thoughtText ? (
              <Accordion
                value={thoughtAccordionValue}
                onValueChange={setThoughtAccordionValue}
                className="mb-3.5"
              >
                <AccordionItem
                  value="thought"
                  className="border border-white/10 bg-black rounded-lg"
                >
                  <AccordionTrigger
                    className="p-3.5 hover:bg-zinc-900/60 text-zinc-400"
                    chevronClassName="text-zinc-400 group-hover:text-zinc-300"
                  >
                    <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Model Reasoning
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-white/5 px-4 py-3 text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
                    {thoughtText}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}

            {/* Formatted Tool Calls with Accordion */}
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
                    <Accordion
                      key={tc.id || tc.toolCallId || `${toolName}-${tcIndex}`}
                      defaultValue={`tc-${tcIndex}`}
                      className="w-full"
                    >
                      <AccordionItem
                        value={`tc-${tcIndex}`}
                        className="rounded-lg border border-white/8 bg-black"
                      >
                        <AccordionTrigger className="p-3 hover:bg-zinc-900/60 text-zinc-400">
                          <div className="flex items-center gap-2">
                            <Terminal size={13} className="text-zinc-400" />
                            <span className="font-mono text-xs font-semibold text-zinc-200">
                              Action: {toolName}
                            </span>
                            {tc.id && (
                              <span className="font-mono text-[10px] text-zinc-500">
                                ({tc.id})
                              </span>
                            )}
                          </div>
                        </AccordionTrigger>
                        {hasArgs && (
                          <AccordionContent className="p-3 pt-0">
                            <pre className="font-mono text-[11px] text-zinc-400 overflow-x-auto leading-relaxed bg-zinc-950 p-2.5 rounded-lg border border-white/5">
                              {JSON.stringify(toolArgs, null, 2)}
                            </pre>
                          </AccordionContent>
                        )}
                      </AccordionItem>
                    </Accordion>
                  );
                })}
              </div>
            ) : null}

            {/* Message Content */}
            {cleanContent ? (
              isUser ? (
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white">
                  {cleanContent}
                </div>
              ) : (
                <MarkdownRenderer content={cleanContent} />
              )
            ) : null}
          </div>
        </MessageContent>
      </Message>
    </motion.div>
  );
}
