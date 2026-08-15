"use client";

import * as React from "react";
import {
  orchestratorClient,
  type SessionDetail,
} from "../api/orchestrator-client";
import { MessageBubble } from "./MessageBubble";
import { LiveOutput } from "./LiveOutput";
import { GuardrailApproval } from "./GuardrailApproval";
import { SandboxInfoPanel } from "./SandboxInfoPanel";
import { SessionStreamClient } from "../api/stream-client";
import { useSessionStore } from "../stores/session-store";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, Radio, Shield, ArrowRight, Loader2 } from "lucide-react";
import { PromptInput } from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo, CrucibleWordmark } from "@/components/Logo";

interface ChatWindowProps {
  session: SessionDetail | null;
  onSendMessage: (text: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export function ChatWindow({
  session,
  onSendMessage,
  loading = false,
  error = null,
}: ChatWindowProps) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [showSandboxInfo, setShowSandboxInfo] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Streaming real-time state
  const streamingTokens = useSessionStore((s) => s.streamingTokens);
  const streamingThought = useSessionStore((s) => s.streamingThought);
  const activeToolCalls = useSessionStore((s) => s.activeToolCalls);
  const toolStdout = useSessionStore((s) => s.toolStdout);
  const toolStderr = useSessionStore((s) => s.toolStderr);
  const isStreamConnected = useSessionStore((s) => s.isStreamConnected);
  const appendStreamingTokens = useSessionStore((s) => s.appendStreamingTokens);
  const setStreamingThought = useSessionStore((s) => s.setStreamingThought);
  const setActiveToolCalls = useSessionStore((s) => s.setActiveToolCalls);
  const appendToolStdout = useSessionStore((s) => s.appendToolStdout);
  const appendToolStderr = useSessionStore((s) => s.appendToolStderr);
  const setStreamConnected = useSessionStore((s) => s.setStreamConnected);
  const clearStreamingState = useSessionStore((s) => s.clearStreamingState);
  const setStatus = useSessionStore((s) => s.setStatus);

  const streamClientRef = React.useRef<SessionStreamClient | null>(null);

  // Connect SSE stream whenever active session changes
  React.useEffect(() => {
    if (!session?.id) {
      if (streamClientRef.current) {
        streamClientRef.current.disconnect();
        streamClientRef.current = null;
      }
      setStreamConnected(false);
      return;
    }

    clearStreamingState();

    const client = new SessionStreamClient(session.id, { transport: "sse" });
    streamClientRef.current = client;

    client.on("token", (data) => {
      appendStreamingTokens(data.delta);
    });

    client.on("thought", (data) => {
      setStreamingThought(data.thought);
    });

    client.on("tool_start", (data) => {
      setActiveToolCalls(data.toolCalls);
    });

    client.on("tool_stdout", (data) => {
      appendToolStdout(data.chunk);
    });

    client.on("tool_stderr", (data) => {
      appendToolStderr(data.chunk);
    });

    client.on("status_change", (data) => {
      setStatus(data.status as any);
      if (data.status === "done" || data.status === "error") {
        setSending(false);
      }
    });

    client.onConnectionChange((connected) => {
      setStreamConnected(connected);
    });

    client.connect();

    return () => {
      client.disconnect();
      streamClientRef.current = null;
    };
  }, [
    session?.id,
    appendStreamingTokens,
    setStreamingThought,
    setActiveToolCalls,
    appendToolStdout,
    appendToolStderr,
    setStreamConnected,
    clearStreamingState,
    setStatus,
  ]);

  // Auto-scroll when messages, tokens, thoughts, or tools update
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    session?.messages,
    streamingTokens,
    streamingThought,
    activeToolCalls,
    toolStdout,
  ]);

  const handleSubmit = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    clearStreamingState();

    try {
      await onSendMessage(text);
    } catch {
      // errors handled by parent store
    } finally {
      setSending(false);
    }
  };

  const handleSuggestion = (promptText: string) => {
    setInput(promptText);
    void handleSubmit(promptText);
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center bg-zinc-950 h-screen">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 text-zinc-400 font-sans"
        >
          <Loader2 size={24} className="animate-spin text-primary" />
          <p className="text-xs font-medium">
            Connecting to session runtime...
          </p>
        </motion.div>
      </main>
    );
  }

  // Welcome Screen (when session is null or on initial landing)
  if (!session) {
    return (
      <main className="flex-1 flex flex-col justify-between bg-zinc-950 h-screen p-6 sm:p-10 font-sans relative overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full text-center space-y-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="p-3.5 rounded-2xl bg-zinc-900 border border-primary/20 shadow-xl">
              <Logo className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 text-primary" />
            </div>
            <div className="space-y-1">
              <CrucibleWordmark className="text-4xl sm:text-5xl text-white block leading-none" />
              <p className="text-xs text-primary/80 uppercase tracking-widest">
                Reasoning Orchestrator
              </p>
            </div>
          </motion.div>

          <div className="space-y-2">
            <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              Self-hostable autonomous agent execution engine with sandboxed
              subprocesses, policy guardrails, and real-time observability.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left pt-2">
            <button
              type="button"
              onClick={() =>
                handleSuggestion(
                  "Check the repository package.json and list its dependencies",
                )
              }
              className="flex flex-col gap-1.5 rounded-lg border border-white/8 hover:border-primary/30 bg-zinc-900/60 hover:bg-zinc-900 p-4 transition-all group text-left"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover:text-white">
                <span>Inspect Workspace</span>
                <ArrowRight
                  size={13}
                  className="text-zinc-500 group-hover:text-primary transition-colors"
                />
              </div>
              <span className="text-xs text-zinc-500 group-hover:text-zinc-400">
                &ldquo;Check repository package.json and list
                dependencies&rdquo;
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleSuggestion(
                  "Run a shell command using bash_exec to inspect system info",
                )
              }
              className="flex flex-col gap-1.5 rounded-lg border border-white/8 hover:border-primary/30 bg-zinc-900/60 hover:bg-zinc-900 p-4 transition-all group text-left"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover:text-white">
                <span>Execute Bash Subprocess</span>
                <ArrowRight
                  size={13}
                  className="text-zinc-500 group-hover:text-primary transition-colors"
                />
              </div>
              <span className="text-xs text-zinc-500 group-hover:text-zinc-400">
                &ldquo;Run a shell command using bash_exec to inspect system
                info&rdquo;
              </span>
            </button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto w-full pt-4">
          <PromptInput
            value={input}
            onChange={setInput}
            onSubmit={() => {
              void handleSubmit();
            }}
            isLoading={sending}
            placeholder="Type your instruction to start a new session..."
            disabled={sending}
          />
        </div>
      </main>
    );
  }

  const messages = session.messages || [];

  const pendingTool = React.useMemo(() => {
    if (activeToolCalls.length > 0) return activeToolCalls[0];
    const msgs = session.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.toolCalls && m.toolCalls.length > 0) {
        return m.toolCalls[0];
      }
    }
    return undefined;
  }, [activeToolCalls, session.messages]);

  return (
    <main className="flex-1 flex flex-col h-screen bg-zinc-950 font-sans relative overflow-hidden">
      {/* Session Top Bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/8 bg-zinc-950/85 px-6 backdrop-blur-xl">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
            <span>{session.title || session.id}</span>
          </h2>
          <span className="text-[10px] text-zinc-500">ID: {session.id}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Stream Connection Indicator */}
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
              isStreamConnected
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
            }`}
          >
            <Radio
              size={12}
              className={session.status === "running" ? "animate-pulse" : ""}
            />
            <span>{isStreamConnected ? "STREAM LIVE" : "CONNECTING"}</span>
          </div>

          {/* Sandbox Info Panel Trigger */}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setShowSandboxInfo(true)}
            className="gap-1.5 border-white/10 bg-zinc-900 text-zinc-300 hover:text-white"
          >
            <Shield size={12} className="text-primary" />
            <span>Sandbox Info</span>
          </Button>

          {/* Turn Counter */}
          <span className="hidden sm:inline-flex px-2 py-0.5 rounded-md bg-zinc-900 border border-white/8 text-[11px] text-zinc-400">
            Turns: {session.metadata?.turnCount || 0}
          </span>

          {/* Status Badge */}
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
              session.status === "running"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : session.status === "awaiting_human"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : session.status === "error"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                    : "bg-primary/10 text-primary border-primary/30"
            }`}
          >
            {session.status}
          </span>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-4">
        {messages.map((message, index) => (
          <MessageBubble
            key={`${message.role}-${index}`}
            message={message}
            index={index}
          />
        ))}

        {/* Guardrail Human Review Checkpoint Card */}
        {session.status === "awaiting_human" && (
          <GuardrailApproval
            sessionId={session.id}
            toolName={pendingTool?.name || "bash_exec"}
            toolCallId={pendingTool?.id}
            args={pendingTool?.arguments}
            policyReason="Irreversible Action Policy: Destructive filesystem or root command requires manual confirmation."
            onDecisionComplete={async (action) => {
              try {
                const refreshed = await orchestratorClient.getSession(
                  session.id,
                );
                setStatus(refreshed.status as any);
              } catch {}
            }}
          />
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 border border-white/8 text-zinc-400 text-xs w-fit my-3"
            >
              <Loader2 size={14} className="animate-spin text-primary" />
              <span>Reasoning & executing tools in sandbox...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2.5 p-4 rounded-lg bg-rose-950/20 border border-rose-500/30 text-rose-300 text-xs my-3"
          >
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <div className="border-t border-white/8 bg-zinc-950/90 px-4 sm:px-8 py-4 backdrop-blur-xl">
        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={() => {
            void handleSubmit();
          }}
          isLoading={sending}
          placeholder="Type your message or instruction..."
          disabled={sending}
        />
      </div>

      {/* Sandbox Isolation & Resource Budget Modal */}
      <SandboxInfoPanel
        isOpen={showSandboxInfo}
        onClose={() => setShowSandboxInfo(false)}
        sessionId={session.id}
      />
    </main>
  );
}
