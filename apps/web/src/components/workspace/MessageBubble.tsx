"use client";

import * as React from "react";
import type { AgentMessage } from "@/api/orchestrator-client";
import { motion, AnimatePresence } from "motion/react";
import {
  Terminal,
  CheckCircle2,
  User,
  Bot,
  Send,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

interface MessageBubbleProps {
  message: AgentMessage;
  index?: number;
}

export function MessageBubble({ message, index = 0 }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const [thoughtAccordionValue, setThoughtAccordionValue] = React.useState<
    string[]
  >([]);

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

        {cleanContent && (
          <div className="flex items-center justify-start gap-1 mt-1.5 ml-0.5">
            <CopyButton text={cleanContent} />
          </div>
        )}
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

        <Accordion
          defaultValue={["obs"]}
          className="w-[600px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/8 bg-black/80 shadow-md"
        >
          <AccordionItem value="obs" className="border-none">
            <AccordionTrigger className="p-3 text-zinc-400 hover:bg-zinc-900/60">
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
              <pre className="max-h-72 overflow-x-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                {cleanContent}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Action Row Below Observation Log (Left-Aligned) */}
        {cleanContent && (
          <div className="flex items-center justify-start gap-1 mt-1.5 ml-0.5">
            <CopyButton text={cleanContent} />
          </div>
        )}
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
      className="w-full my-2.5 group"
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
            className={`max-w-[88%] sm:max-w-[82%] transition-all ${
              isUser
                ? "bg-slate-800 text-white p-4 rounded-4xl rounded-br-none backdrop-blur-md"
                : isErrorMessage
                  ? "bg-rose-950 text-rose-200 rounded-tl-sm backdrop-blur-md"
                  : "text-zinc-100 rounded-tl-sm backdrop-blur-md"
            }`}
          >
            {/* Expandable Reasoning / Thought process using builtin Accordion */}
            {thoughtText ? (
              <Accordion
                value={thoughtAccordionValue}
                onValueChange={(val) =>
                  setThoughtAccordionValue(
                    Array.isArray(val) ? val : val ? [val] : [],
                  )
                }
                className="mb-3.5 w-[800px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 bg-black"
              >
                <AccordionItem value="thought" className="border-none">
                  <AccordionTrigger className="p-3.5 text-zinc-400 hover:bg-zinc-900/60">
                    <div className="flex items-center justify-between w-full pr-2">
                      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                        Model Reasoning
                      </span>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="max-h-60 overflow-y-auto border-t border-white/5 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-400 break-words">
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
                      defaultValue={[`tc-${tcIndex}`]}
                      className="w-[600px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/8 bg-black"
                    >
                      <AccordionItem
                        value={`tc-${tcIndex}`}
                        className="border-none"
                      >
                        <AccordionTrigger className="p-3 text-zinc-400 hover:bg-zinc-900/60">
                          <div className="flex min-w-0 items-center gap-2">
                            <Terminal
                              size={13}
                              className="shrink-0 text-zinc-400"
                            />

                            <span className="font-mono text-xs font-semibold text-zinc-200">
                              Action: {toolName}
                            </span>

                            {tc.id && (
                              <span className="truncate font-mono text-[10px] text-zinc-500">
                                ({tc.id})
                              </span>
                            )}
                          </div>
                        </AccordionTrigger>

                        {hasArgs && (
                          <AccordionContent className="p-0">
                            <pre className="overflow-x-auto rounded-lg border border-white/5 bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400">
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

          {/* Action Row Below User Prompt Bubble (Right-Aligned) */}
          {isUser && cleanContent && (
            <div className="flex items-center justify-end gap-1 mt-1 mr-1">
              <CopyButton text={cleanContent} />
            </div>
          )}

          {/* Action Row Below Assistant Output (Left-Aligned) */}
          {!isUser && cleanContent && (
            <div className="flex items-center justify-start gap-1 mt-1.5 ml-0.5">
              <CopyButton text={cleanContent} />
            </div>
          )}
        </MessageContent>
      </Message>
    </motion.div>
  );
}
