"use client";

import * as React from "react";
import type { SessionDetail } from "../api/orchestrator-client";
import { MessageBubble } from "./MessageBubble";
import { LiveOutput } from "./LiveOutput";
import { SessionStreamClient } from "../api/stream-client";
import { useSessionStore } from "../stores/session-store";
import { motion, AnimatePresence } from "motion/react";
import {
  Send,
  Loader2,
  Sparkles,
  AlertCircle,
  Terminal,
  Cpu,
  Radio,
} from "lucide-react";

interface ChatWindowProps {
  session?: SessionDetail | null;
  onSendMessage: (message: string) => Promise<void>;
  loading?: boolean;
  sending?: boolean;
  error?: string | null;
}

export function ChatWindow({
  session,
  onSendMessage,
  loading = false,
  sending = false,
  error = null,
}: ChatWindowProps) {
  const [input, setInput] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const {
    streamingThought,
    streamingTokens,
    activeToolCalls,
    toolStdout,
    toolStderr,
    isStreamConnected,
    setStreamConnected,
    setStreamingThought,
    appendStreamingTokens,
    setActiveToolCalls,
    appendToolStdout,
    appendToolStderr,
    clearStreamingState,
    addMessageToCurrentSession,
    setStatus,
  } = useSessionStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [session?.messages, sending, streamingTokens, toolStdout]);

  // Set up real-time SSE stream subscription for the active session
  React.useEffect(() => {
    if (!session?.id) {
      clearStreamingState();
      return;
    }

    const client = new SessionStreamClient(session.id);
    client.connect();

    const unsubConn = client.onConnectionChange((connected) => {
      setStreamConnected(connected);
    });

    const unsubToken = client.on("token", ({ delta }) => {
      appendStreamingTokens(delta);
    });

    const unsubThought = client.on("thought", ({ thought }) => {
      setStreamingThought(thought);
    });

    const unsubToolStart = client.on("tool_start", ({ toolCalls }) => {
      setActiveToolCalls(toolCalls);
    });

    const unsubToolStdout = client.on("tool_stdout", ({ chunk }) => {
      appendToolStdout(chunk);
    });

    const unsubToolStderr = client.on("tool_stderr", ({ chunk }) => {
      appendToolStderr(chunk);
    });

    const unsubToolResult = client.on("tool_result", () => {
      setActiveToolCalls([]);
    });

    const unsubStatus = client.on("status_change", ({ status }) => {
      setStatus(status as any);
      if (status === "done" || status === "idle") {
        clearStreamingState();
      }
    });

    const unsubDone = client.on("done", () => {
      clearStreamingState();
    });

    return () => {
      unsubConn();
      unsubToken();
      unsubThought();
      unsubToolStart();
      unsubToolStdout();
      unsubToolStderr();
      unsubToolResult();
      unsubStatus();
      unsubDone();
      client.dispose();
      setStreamConnected(false);
    };
  }, [session?.id]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setInput("");
    clearStreamingState();
    await onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (loading && !session) {
    return (
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          height: "100vh",
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            color: "#a1a1aa",
          }}
        >
          <Loader2 size={24} className="animate-spin" />
          <p style={{ fontSize: "13px" }}>Loading session...</p>
        </motion.div>
      </main>
    );
  }

  if (!session) {
    return (
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          height: "100vh",
          padding: "24px",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
          style={{ textAlign: "center", maxWidth: "440px" }}
        >
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "14px",
              background: "#18181b",
              border: "1px solid #27272a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Sparkles size={26} color="#f4f4f5" />
          </div>
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 700,
              marginBottom: "8px",
              color: "#f4f4f5",
              letterSpacing: "-0.01em",
            }}
          >
            Welcome to Crucible
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: "#71717a",
              lineHeight: 1.6,
              marginBottom: "20px",
            }}
          >
            Autonomous reasoning harness with local subprocess execution,
            multi-session actor isolation, and OpenRouter intelligence.
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "#71717a",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Try asking:
            </div>
            <div
              style={{
                padding: "10px 14px",
                background: "#121215",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#a1a1aa",
              }}
            >
              &ldquo;Check the repository package.json and tell me its
              dependencies&rdquo;
            </div>
            <div
              style={{
                padding: "10px 14px",
                background: "#121215",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#a1a1aa",
              }}
            >
              &ldquo;Run a shell command using bash_exec to inspect system
              info&rdquo;
            </div>
          </div>
        </motion.div>
      </main>
    );
  }

  const messages = session.messages || [];

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#09090b",
        position: "relative",
      }}
    >
      {/* Session Header */}
      <header
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid #27272a",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(9, 9, 11, 0.85)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#f4f4f5",
              letterSpacing: "-0.01em",
            }}
          >
            {session.title || session.id}
          </h2>
          <p style={{ fontSize: "11px", color: "#71717a" }}>ID: {session.id}</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Stream Connection Indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "11px",
              padding: "4px 8px",
              borderRadius: "5px",
              background: isStreamConnected
                ? "rgba(34, 197, 94, 0.1)"
                : "rgba(234, 179, 8, 0.1)",
              border: `1px solid ${isStreamConnected ? "rgba(34, 197, 94, 0.25)" : "rgba(234, 179, 8, 0.25)"}`,
              color: isStreamConnected ? "#22c55e" : "#eab308",
              fontWeight: 600,
            }}
          >
            <Radio
              size={11}
              className={session.status === "running" ? "animate-pulse" : ""}
            />
            <span>{isStreamConnected ? "STREAM ACTIVE" : "CONNECTING"}</span>
          </div>

          <div
            style={{
              fontSize: "11px",
              padding: "4px 9px",
              borderRadius: "5px",
              background: "#18181b",
              border: "1px solid #27272a",
              color: "#a1a1aa",
            }}
          >
            Turns: {session.metadata?.turnCount || 0}
          </div>

          {/* Status Badge */}
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "4px 9px",
              borderRadius: "5px",
              background:
                session.status === "running"
                  ? "rgba(234, 179, 8, 0.12)"
                  : session.status === "error"
                    ? "rgba(239, 68, 68, 0.12)"
                    : "rgba(34, 197, 94, 0.12)",
              color:
                session.status === "running"
                  ? "#eab308"
                  : session.status === "error"
                    ? "#ef4444"
                    : "#22c55e",
              border: `1px solid ${
                session.status === "running"
                  ? "rgba(234, 179, 8, 0.28)"
                  : session.status === "error"
                    ? "rgba(239, 68, 68, 0.28)"
                    : "rgba(34, 197, 94, 0.28)"
              }`,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            {session.status === "running" && (
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: "#eab308",
                }}
              />
            )}
            <span>{session.status}</span>
          </div>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              maxWidth: "400px",
              color: "#71717a",
            }}
          >
            <p
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "#a1a1aa",
                marginBottom: "6px",
              }}
            >
              Start reasoning in this session
            </p>
            <p style={{ fontSize: "12px", lineHeight: 1.5 }}>
              Ask a question, perform calculations, or execute shell commands
              via `bash_exec`.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={`${msg.role}_${idx}`}
              message={msg}
              index={idx}
            />
          ))
        )}

        {/* Real-time Streaming Output Panel */}
        <LiveOutput
          streamingThought={streamingThought}
          streamingTokens={streamingTokens}
          activeToolCalls={activeToolCalls}
          toolStdout={toolStdout}
          toolStderr={toolStderr}
          isConnected={isStreamConnected}
          status={session.status as any}
        />

        {/* Loading Indicator */}
        <AnimatePresence>
          {sending && !streamingTokens && !toolStdout && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "8px",
                background: "#121215",
                border: "1px solid #27272a",
                width: "fit-content",
                margin: "12px 0",
                color: "#a1a1aa",
                fontSize: "13px",
              }}
            >
              <Loader2 size={15} className="animate-spin" />
              <span>Reasoning & executing tools...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 16px",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              fontSize: "13px",
              margin: "12px 0",
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div
        style={{
          padding: "16px 24px 20px",
          borderTop: "1px solid #27272a",
          background: "#09090b",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            position: "relative",
            background: "#121215",
            border: "1px solid #27272a",
            borderRadius: "10px",
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            transition: "border 0.15s ease",
          }}
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message or instruction... (Enter to send, Shift+Enter for newline)"
            disabled={sending}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f4f4f5",
              fontSize: "14px",
              resize: "none",
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "4px",
            }}
          >
            <span style={{ fontSize: "11px", color: "#52525b" }}>
              Press <b>Enter</b> to send
            </span>

            <motion.button
              type="submit"
              disabled={!input.trim() || sending}
              whileHover={{ scale: input.trim() && !sending ? 1.03 : 1 }}
              whileTap={{ scale: input.trim() && !sending ? 0.96 : 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: input.trim() && !sending ? "#ffffff" : "#27272a",
                color: input.trim() && !sending ? "#09090b" : "#71717a",
                border: "none",
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: input.trim() && !sending ? "pointer" : "not-allowed",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {sending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
              <span>Send</span>
            </motion.button>
          </div>
        </form>
      </div>
    </main>
  );
}
