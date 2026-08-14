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
} from "lucide-react";

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
        style={{ margin: "10px 0", paddingLeft: "36px" }}
      >
        <div
          style={{
            background: "rgba(18, 18, 21, 0.75)",
            border: "1px solid #27272a",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <CheckCircle2 size={14} color="#22c55e" />
            <span
              style={{
                fontWeight: 600,
                color: "#a1a1aa",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Observation {message.name ? `• ${message.name}` : ""}
            </span>
          </div>
          <pre
            style={{
              background: "#09090b",
              padding: "10px 12px",
              borderRadius: "6px",
              overflowX: "auto",
              color: "#e4e4e7",
              fontSize: "12px",
              lineHeight: 1.5,
              border: "1px solid #18181b",
              fontFamily: "JetBrains Mono, monospace",
              margin: 0,
            }}
          >
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
        delay: Math.min(index * 0.04, 0.2),
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        margin: "14px 0",
        gap: "6px",
      }}
    >
      {/* Sender Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#a1a1aa",
          padding: "0 4px",
        }}
      >
        {isUser ? (
          <>
            <span>You</span>
            <div
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "#27272a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <User size={12} color="#f4f4f5" />
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "#27272a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Bot size={12} color="#f4f4f5" />
            </div>
            <span>Crucible Agent</span>
          </>
        )}
      </div>

      {/* Message Card Container */}
      <div
        style={{
          maxWidth: "85%",
          background: isUser
            ? "#18181b"
            : isErrorMessage
              ? "rgba(239, 68, 68, 0.08)"
              : "#121215",
          border: isUser
            ? "1px solid #3f3f46"
            : isErrorMessage
              ? "1px solid rgba(239, 68, 68, 0.3)"
              : "1px solid #27272a",
          borderRadius: isUser ? "12px 2px 12px 12px" : "2px 12px 12px 12px",
          padding: "14px 18px",
          color: "#f4f4f5",
          lineHeight: 1.6,
          fontSize: "14px",
          boxShadow: "0 2px 12px rgba(0, 0, 0, 0.25)",
        }}
      >
        {/* Expandable Reasoning / Thought process */}
        {thoughtText ? (
          <div
            style={{
              marginBottom: "12px",
              background: "#09090b",
              border: "1px solid #27272a",
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setThoughtOpen(!thoughtOpen)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                color: "#a1a1aa",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Brain size={14} color="#eab308" />
                <span>Reasoning Process</span>
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
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      padding: "8px 12px 12px",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      color: "#71717a",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: "11px",
                      borderTop: "1px solid #18181b",
                    }}
                  >
                    {thoughtText}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}

        {/* Formatted Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div
            style={{
              marginBottom: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                style={{
                  background: "#09090b",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                  padding: "8px 12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginBottom: "6px",
                  }}
                >
                  <Terminal size={13} color="#38bdf8" />
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#38bdf8",
                    }}
                  >
                    Action: {tc.name}
                  </span>
                </div>
                <pre
                  style={{
                    fontSize: "11px",
                    color: "#a1a1aa",
                    fontFamily: "JetBrains Mono, monospace",
                    overflowX: "auto",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}

        {/* Message Content */}
        {cleanContent ? (
          <div
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: isErrorMessage ? "#f87171" : "#f4f4f5",
            }}
          >
            {cleanContent}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
