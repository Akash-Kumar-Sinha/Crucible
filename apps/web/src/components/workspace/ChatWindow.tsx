"use client";

import * as React from "react";
import {
  orchestratorClient,
  type SessionDetail,
  type AgentMessage,
} from "@/api/orchestrator-client";
import { MessageBubble } from "@/components/workspace/MessageBubble";
import { LiveOutput } from "@/components/workspace/LiveOutput";
import { GuardrailApproval } from "@/components/workspace/GuardrailApproval";
import { SandboxInfoPanel } from "@/components/workspace/SandboxInfoPanel";
import { QueuePositionBadge } from "@/components/status/QueuePositionBadge";
import { RoleModelPicker } from "@/components/workspace/RoleModelPicker";
import { InterSessionFeed } from "@/components/workspace/InterSessionFeed";
import { SessionStreamClient } from "@/api/stream-client";
import {
  useSessionStore,
  type SessionStoreState,
} from "@/stores/session-store";
import {
  PreviewToggle,
  type PreviewLayoutMode,
} from "@/components/workspace/PreviewToggle";
import { LivePreviewPane } from "@/components/workspace/LivePreviewPane";
import type { PreviewInfo } from "@/api/orchestrator-client";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertCircle,
  Radio,
  Shield,
  ArrowRight,
  Loader2,
  Cpu,
  ChevronDown,
} from "lucide-react";
import { PromptInput } from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import { captureClientError } from "@/lib/error-reporter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
} from "@/components/ui/questionnaire";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";

const roleStyles: Record<string, { label: string; className: string }> = {
  coder: {
    label: "Coder",
    className: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  },
  test_writer: {
    label: "Test Writer",
    className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  },
  bug_hunter: {
    label: "Bug Hunter",
    className: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  },
  bug_fixer: {
    label: "Bug Fixer",
    className: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  },
  general: {
    label: "General",
    className: "bg-zinc-800/80 text-zinc-300 border-white/10",
  },
};

interface ChatWindowProps {
  session: SessionDetail | null;
  onSendMessage: (text: string, model?: string, role?: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

type SessionStatus = SessionStoreState["status"];

function toSessionStatus(status: string | undefined): SessionStatus {
  switch (status) {
    case "queued":
    case "running":
    case "done":
    case "error":
    case "awaiting_human":
      return status;
    default:
      return "idle";
  }
}

export function ChatWindow({
  session,
  onSendMessage,
  loading = false,
  error = null,
}: ChatWindowProps) {
  const [input, setInput] = React.useState("");
  const [selectedRole, setSelectedRole] = React.useState<string>("coder");
  const [selectedModel, setSelectedModel] = React.useState<string>(
    "anthropic/claude-3.5-sonnet",
  );
  const [sending, setSending] = React.useState(false);
  const [showSandboxInfo, setShowSandboxInfo] = React.useState(false);
  const [showInterSessionFeed, setShowInterSessionFeed] = React.useState(false);
  const [previewLayout, setPreviewLayout] =
    React.useState<PreviewLayoutMode>("chat");
  const [previewInfo, setPreviewInfo] = React.useState<PreviewInfo | null>(
    null,
  );
  const [infraData, setInfraData] = React.useState<any>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Sync active session role & model into state
  React.useEffect(() => {
    if (session) {
      const activeRole = session.role || (session.metadata?.role as string);
      if (activeRole) setSelectedRole(activeRole);
      const activeModel = session.model || (session.metadata?.model as string);
      if (activeModel) setSelectedModel(activeModel);
    }
  }, [
    session?.id,
    session?.role,
    session?.model,
    session?.metadata?.role,
    session?.metadata?.model,
  ]);

  // Streaming real-time state from Zustand store
  const streamingTokens = useSessionStore((s) => s.streamingTokens);
  const streamingThought = useSessionStore((s) => s.streamingThought);
  const activeToolCalls = useSessionStore((s) => s.activeToolCalls);
  const toolStdout = useSessionStore((s) => s.toolStdout);
  const toolStderr = useSessionStore((s) => s.toolStderr);
  const isStreamConnected = useSessionStore((s) => s.isStreamConnected);
  const agentState = useSessionStore((s) => s.agentState);
  const storeStatus = useSessionStore((s) => s.status);
  const appendStreamingTokens = useSessionStore((s) => s.appendStreamingTokens);
  const appendStreamingThought = useSessionStore(
    (s) => s.appendStreamingThought,
  );
  const setActiveToolCalls = useSessionStore((s) => s.setActiveToolCalls);
  const appendToolStdout = useSessionStore((s) => s.appendToolStdout);
  const appendToolStderr = useSessionStore((s) => s.appendToolStderr);
  const setStreamConnected = useSessionStore((s) => s.setStreamConnected);
  const clearStreamingState = useSessionStore((s) => s.clearStreamingState);
  const setStatus = useSessionStore((s) => s.setStatus);
  const setAgentState = useSessionStore((s) => s.setAgentState);
  const addMessageToCurrentSession = useSessionStore(
    (s) => s.addMessageToCurrentSession,
  );
  const updateSessionTitle = useSessionStore((s) => s.updateSessionTitle);

  const effectiveStatus = storeStatus || toSessionStatus(session?.status);

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

    client.on("connected", (data) => {
      if (data.status) setStatus(toSessionStatus(data.status));
      if (data.state) setAgentState(data.state as any);
    });

    client.on("token", (data) => {
      appendStreamingTokens(data.delta);
    });

    client.on("thought", (data) => {
      appendStreamingThought(data.thought);
    });

    client.on("tool_start", (data) => {
      setActiveToolCalls(data.toolCalls);
    });

    client.on("tool_result", () => {
      setActiveToolCalls([]);
    });

    client.on("message", (data) => {
      if (data.message) {
        addMessageToCurrentSession(data.message);
        clearStreamingState();
      }
    });

    client.on("inter_session_message", (data) => {
      if (data?.message) {
        const preview =
          data.message.payload?.content ||
          data.message.payload?.task ||
          "Cross-session message received";
        const synthetic: AgentMessage = {
          role: "system",
          content: `[Inter-Session Message from ${data.message.sourceSessionId} (${data.message.type})]: ${preview}`,
        };
        addMessageToCurrentSession(synthetic);
      }
    });

    client.on("tool_stdout", (data) => {
      appendToolStdout(data.chunk);
    });

    client.on("tool_stderr", (data) => {
      appendToolStderr(data.chunk);
    });

    client.on("state_change", (data) => {
      if (data.to) {
        setAgentState(data.to as any);
      }
    });

    client.on("status_change", (data: any) => {
      if (data.status) setStatus(toSessionStatus(data.status));
      if (data.title && session?.id) {
        updateSessionTitle(session.id, data.title);
      }
      if (data.status === "done" || data.status === "error") {
        setSending(false);
        clearStreamingState();
      }
    });

    client.on("done", () => {
      setSending(false);
      clearStreamingState();
    });

    client.onConnectionChange((connected) => {
      setStreamConnected(connected);
    });

    client.connect();

    return () => {
      client.disconnect();
      streamClientRef.current = null;
    };
  }, [session?.id]);

  // Observer Pattern: Poll infrastructure and queue position status
  React.useEffect(() => {
    if (!session?.id) return;
    let isMounted = true;
    const fetchInfra = async () => {
      try {
        const res = await orchestratorClient.getInfraStatus(session.id);
        if (isMounted && res.data) {
          setInfraData(res.data);
        }
      } catch {
        // ignore background poll errors
      }
    };

    fetchInfra();
    const interval = setInterval(fetchInfra, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [session?.id]);

  // Poll active preview server status
  React.useEffect(() => {
    if (!session?.id) return;
    let isMounted = true;

    const fetchPreview = async () => {
      try {
        const res = await orchestratorClient.getPreviewStatus(session.id);
        if (isMounted) {
          setPreviewInfo(res.preview);
        }
      } catch {
        // ignore background poll errors
      }
    };

    fetchPreview();
    const interval = setInterval(fetchPreview, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [session?.id]);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef<boolean>(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] =
    React.useState<boolean>(false);

  const handleScroll = React.useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 100;
    const isAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    isAtBottomRef.current = isAtBottom;
    setShowScrollBottomBtn(!isAtBottom);
  }, []);

  const scrollToBottom = React.useCallback((smooth = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }, []);

  // Auto-scroll when messages or streaming tokens update ONLY if user is already at bottom
  React.useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false);
    }
  }, [
    session?.messages,
    streamingTokens,
    streamingThought,
    activeToolCalls,
    toolStdout,
    scrollToBottom,
  ]);

  const handleSubmit = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    clearStreamingState();
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setTimeout(() => scrollToBottom(true), 50);

    try {
      await onSendMessage(text, selectedModel, selectedRole);
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

  const storeCurrentSession = useSessionStore((s) => s.currentSession);

  const messages = React.useMemo(() => {
    if (
      storeCurrentSession?.id === session?.id &&
      storeCurrentSession?.messages &&
      storeCurrentSession.messages.length >= (session?.messages?.length || 0)
    ) {
      return storeCurrentSession.messages;
    }
    return session?.messages || [];
  }, [
    storeCurrentSession?.id,
    storeCurrentSession?.messages,
    session?.id,
    session?.messages,
  ]);

  const pendingTool = React.useMemo(() => {
    if (activeToolCalls.length > 0) return activeToolCalls[0];
    const msgs = messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.toolCalls && m.toolCalls.length > 0) {
        return m.toolCalls[0];
      }
    }
    return undefined;
  }, [activeToolCalls, messages]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center bg-zinc-950 h-screen">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 text-zinc-400 "
        >
          <Loader2 size={24} className="animate-spin text-zinc-400" />
          <p className="text-xs font-medium font-mono">
            Connecting to session runtime...
          </p>
        </motion.div>
      </main>
    );
  }

  // Welcome Screen (when session is null on empty workspace)
  if (!session) {
    return (
      <main className="flex-1 flex flex-col justify-between bg-zinc-950 h-full relative overflow-hidden">
        {/* Topbar */}
        <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 bg-zinc-950/90 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4 bg-white/10"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    href="/workspace"
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    Build Your Application
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-zinc-600" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-xs text-zinc-200">
                    Data Fetching
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full text-center space-y-6 z-10 p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="flex flex-col items-center gap-3"
          >
            <Logo className="w-12 h-12 text-white" />
            <div className="space-y-1">
              <CrucibleWordmark className="text-3xl sm:text-4xl text-white block leading-none" />
              <p className="text-xs font-mono text-zinc-400 uppercase tracking-widest mt-1">
                Reasoning Orchestrator
              </p>
            </div>
          </motion.div>

          <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
            Self-hostable autonomous agent execution engine with sandboxed
            subprocesses, policy guardrails, and real-time observability.
          </p>

          <Questionnaire className="w-full text-left pt-2">
            <QuestionnaireItem name="starter-templates">
              <QuestionnaireChoices className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <QuestionnaireChoice
                  value="inspect-workspace"
                  onClick={() =>
                    handleSuggestion(
                      "Check the repository package.json and list its dependencies",
                    )
                  }
                  className="rounded-lg border border-white/8 hover:border-white/20 bg-zinc-800/40 hover:bg-zinc-800/70 p-4 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover/questionnaire-choice:text-white w-full">
                    <span>Inspect Workspace</span>
                    <ArrowRight
                      size={13}
                      className="text-zinc-500 group-hover/questionnaire-choice:text-white transition-colors"
                    />
                  </div>
                  <QuestionnaireChoiceDescription className="text-xs text-zinc-500 group-hover/questionnaire-choice:text-zinc-400 leading-relaxed">
                    &ldquo;Check repository package.json and list
                    dependencies&rdquo;
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>

                <QuestionnaireChoice
                  value="execute-bash"
                  onClick={() =>
                    handleSuggestion(
                      "Run a shell command using bash_exec to inspect system info",
                    )
                  }
                  className="rounded-lg border border-white/8 hover:border-white/20 bg-zinc-800/40 hover:bg-zinc-800/70 p-4 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover/questionnaire-choice:text-white w-full">
                    <span>Execute Bash Subprocess</span>
                    <ArrowRight
                      size={13}
                      className="text-zinc-500 group-hover/questionnaire-choice:text-white transition-colors"
                    />
                  </div>
                  <QuestionnaireChoiceDescription className="text-xs text-zinc-500 group-hover/questionnaire-choice:text-zinc-400 leading-relaxed">
                    &ldquo;Run a shell command using bash_exec to inspect system
                    info&rdquo;
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>

                <QuestionnaireChoice
                  value="policy-checkpoint"
                  onClick={() =>
                    handleSuggestion(
                      "Test the guardrail policies by running a command that requires human approval",
                    )
                  }
                  className="rounded-lg border border-white/8 hover:border-white/20 bg-zinc-800/40 hover:bg-zinc-800/70 p-4 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover/questionnaire-choice:text-white w-full">
                    <span>Policy Checkpoint</span>
                    <ArrowRight
                      size={13}
                      className="text-zinc-500 group-hover/questionnaire-choice:text-white transition-colors"
                    />
                  </div>
                  <QuestionnaireChoiceDescription className="text-xs text-zinc-500 group-hover/questionnaire-choice:text-zinc-400 leading-relaxed">
                    &ldquo;Test irreversible action interception and
                    review&rdquo;
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>

                <QuestionnaireChoice
                  value="sandbox-diagnostics"
                  onClick={() =>
                    handleSuggestion(
                      "Inspect cgroups v2 resource limits and network isolation state",
                    )
                  }
                  className="rounded-lg border border-white/8 hover:border-white/20 bg-zinc-800/40 hover:bg-zinc-800/70 p-4 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover/questionnaire-choice:text-white w-full">
                    <span>Sandbox Diagnostics</span>
                    <ArrowRight
                      size={13}
                      className="text-zinc-500 group-hover/questionnaire-choice:text-white transition-colors"
                    />
                  </div>
                  <QuestionnaireChoiceDescription className="text-xs text-zinc-500 group-hover/questionnaire-choice:text-zinc-400 leading-relaxed">
                    &ldquo;Inspect cgroups v2 limits and network airgap&rdquo;
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
              </QuestionnaireChoices>
            </QuestionnaireItem>
          </Questionnaire>
        </div>

        <div className="max-w-3xl mx-auto w-full p-6 pt-0 z-10 space-y-3">
          <RoleModelPicker
            selectedRole={selectedRole}
            selectedModel={selectedModel}
            onRoleChange={setSelectedRole}
            onModelChange={setSelectedModel}
          />
          <PromptInput
            value={input}
            onChange={setInput}
            onSubmit={() => {
              void handleSubmit();
            }}
            isLoading={sending}
            placeholder="Type a goal or command for the Crucible agent..."
            className="w-full"
          />
        </div>
      </main>
    );
  }

  const contextMeta = session?.metadata?.contextWindow || undefined;
  const squadMeta = session?.metadata?.squad as
    | {
        id?: string;
        name?: string;
        stage?: string;
        statusLine?: string;
        activeRole?: string;
      }
    | undefined;
  const currentRole =
    session?.role || (session?.metadata?.role as string) || "general";
  const _currentModel =
    session?.model || (session?.metadata?.model as string) || "openrouter/free";
  const isBugHunter = currentRole === "bug_hunter";

  return (
    <main
      className={`flex-1 flex flex-col h-screen bg-zinc-950 overflow-hidden relative transition-all ${
        isBugHunter
          ? "border-2 border-rose-500/30 shadow-[inset_0_0_40px_rgba(244,63,94,0.06)]"
          : ""
      }`}
    >
      {/* Adversarial Hardened Sandbox & Audit Banner for Bug Hunter */}
      {isBugHunter && (
        <div className="bg-rose-950/60 border-b border-rose-500/30 px-4 sm:px-6 py-1.5 flex items-center justify-between text-xs font-mono text-rose-200 shrink-0">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold uppercase tracking-wider">
              Adversarial Mode
            </span>
            <span className="text-[11px] text-rose-200/90 font-medium">
              Air-Gapped Network • 256MB / 32 PIDs Limits • Read-Only FS •
              Tamper-Evident Audit Active
            </span>
          </div>
          <span className="text-[10px] text-rose-400 font-bold uppercase hidden md:inline">
            Seccomp: Strict
          </span>
        </div>
      )}
      <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 bg-zinc-950/90 backdrop-blur-md z-10 shrink-0">
        {/* Left: Sidebar Trigger + Clean Breadcrumb Navigation */}
        <div className="flex items-center gap-2 min-w-0">
          <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white shrink-0" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4 bg-white/10"
          />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="text-xs">
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink
                  href="/workspace"
                  className="text-zinc-400 hover:text-white"
                >
                  Build Your Application
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block text-zinc-600" />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-zinc-200 font-medium truncate max-w-[200px] sm:max-w-xs">
                  {session.title || `Session ${session.id.slice(-6)}`}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {/* Minimal Role Badge */}
          {currentRole && currentRole !== "general" && (
            <span
              className={`hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono select-none ${
                roleStyles[currentRole]?.className ||
                "bg-zinc-800 text-zinc-400 border-white/10"
              }`}
            >
              {roleStyles[currentRole]?.label || currentRole}
              {currentRole === "bug_hunter" && (
                <span className="text-[8px] font-bold text-rose-300">RO</span>
              )}
            </span>
          )}
        </div>

        {/* Right: Actions, Live Preview Toggle & Quick Tools */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Active Job / Queue status (only shown when active/running/queued) */}
          {effectiveStatus === "running" && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>Running</span>
            </div>
          )}
          {effectiveStatus === "queued" && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Queued #{infraData?.queue?.position ?? 1}</span>
            </div>
          )}

          {/* Live Sandbox Preview Toggle */}
          <PreviewToggle
            mode={previewLayout}
            onChange={(mode) => {
              setPreviewLayout(mode);
              if (
                session?.id &&
                (mode === "preview" || mode === "split") &&
                (!previewInfo || previewInfo.status !== "ready")
              ) {
                void orchestratorClient
                  .startPreview(session.id)
                  .then(() => orchestratorClient.getPreviewStatus(session.id))
                  .then((res) => setPreviewInfo(res.preview))
                  .catch(() => {});
              }
            }}
            active={!!previewInfo && previewInfo.status === "ready"}
            status={previewInfo?.status}
            onRestart={async () => {
              if (session?.id) {
                await orchestratorClient.startPreview(session.id);
                const res = await orchestratorClient.getPreviewStatus(
                  session.id,
                );
                setPreviewInfo(res.preview);
              }
            }}
          />

          {/* Compact Icon Tool Buttons */}
          <div className="flex items-center gap-1 border-l border-white/8 pl-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowSandboxInfo(true)}
              className="h-8 w-8 p-0 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg"
              title="Sandbox Diagnostics & Limits"
            >
              <Shield size={14} />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowInterSessionFeed(!showInterSessionFeed)}
              className={`h-8 w-8 p-0 rounded-lg transition-colors ${
                showInterSessionFeed
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
              title="Cross-Session Feed & Bus"
            >
              <Radio size={14} />
            </Button>
          </div>
        </div>
      </header>

      {/* Squad Stage Status Line Banner */}
      {squadMeta && (
        <div className="bg-sky-950/40 border-b border-sky-500/20 px-4 sm:px-6 py-1.5 flex items-center justify-between text-xs font-mono shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px] font-bold uppercase shrink-0">
              Squad: {squadMeta.name || "Workflow"}
            </span>
            <span className="text-zinc-300 truncate">
              {squadMeta.statusLine || `Stage: ${squadMeta.stage}`}
            </span>
          </div>
          {squadMeta.stage && (
            <span className="text-[10px] text-sky-400/80 uppercase font-semibold shrink-0 ml-2">
              Stage: {squadMeta.stage}
            </span>
          )}
        </div>
      )}

      {/* Main Workspace Area (Chat / Split / Preview) */}
      {previewLayout === "preview" ? (
        <div className="flex-1 overflow-hidden">
          <LivePreviewPane
            sessionId={session.id}
            previewUrl={orchestratorClient.getPreviewUrl(session.id)}
            previewInfo={previewInfo}
            messages={messages}
            onRestart={async () => {
              await orchestratorClient.startPreview(session.id);
              const res = await orchestratorClient.getPreviewStatus(session.id);
              setPreviewInfo(res.preview);
            }}
            onClose={() => setPreviewLayout("chat")}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-row overflow-hidden relative">
          {/* Chat Column */}
          <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
            {/* Messages Scroll Area */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-4 relative"
            >
              <Marker
                variant="separator"
                className="text-zinc-500 text-[11px] font-mono mb-4"
              >
                <MarkerIcon>
                  <Radio size={12} className="text-emerald-400" />
                </MarkerIcon>
                <MarkerContent>
                  Session Initialized • {session.tenantId || "default"} /{" "}
                  {session.namespace || "crucible"}
                </MarkerContent>
              </Marker>

              {/* Compacted/Summarized Past Turns Indicator */}
              {contextMeta?.isSummarized && (
                <div className="my-3">
                  <Marker
                    variant="separator"
                    className="text-zinc-400 text-[11px] font-mono mb-2"
                  >
                    <MarkerIcon>
                      <Cpu size={12} className="text-sky-400" />
                    </MarkerIcon>
                    <MarkerContent>
                      Earlier turns summarized (
                      {contextMeta.summarizedTurnCount || "multiple"} turns) to
                      optimize context window
                    </MarkerContent>
                  </Marker>
                  {contextMeta.runningSummary && (
                    <Accordion className="w-full">
                      <AccordionItem
                        value="context-summary"
                        className="rounded-lg border border-white/8 bg-black/60 shadow-sm"
                      >
                        <AccordionTrigger className="p-3 hover:bg-zinc-900/40 text-zinc-400 text-xs">
                          <span className="font-mono text-[11px] text-zinc-300">
                            View Active Context Memento (
                            {contextMeta.summarizedTurnCount} turns)
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="p-3 pt-0 text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                          {contextMeta.runningSummary}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              )}

              {messages.map((message, index) => (
                <MessageBubble
                  key={`${message.role}-${message.toolCallId || message.name || message.content || "msg"}-${index}`}
                  message={message}
                  index={index}
                />
              ))}

              {/* Guardrail Human Review Checkpoint Card */}
              {effectiveStatus === "awaiting_human" && (
                <GuardrailApproval
                  sessionId={session.id}
                  toolName={pendingTool?.name || "bash_exec"}
                  toolCallId={pendingTool?.id}
                  args={pendingTool?.arguments}
                  policyReason="Irreversible Action Policy: Destructive filesystem or root command requires manual confirmation."
                  onDecisionComplete={async () => {
                    try {
                      const refreshed = await orchestratorClient.getSession(
                        session.id,
                      );
                      setStatus(toSessionStatus(refreshed.status));
                    } catch (err) {
                      captureClientError(err, {
                        component: "ChatWindow",
                        action: "refresh_after_guardrail_decision",
                        sessionId: session.id,
                      });
                    }
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
                _isConnected={isStreamConnected}
                status={effectiveStatus}
                agentState={agentState}
              />

              {/* Queued Load Leveling Banner */}
              <AnimatePresence>
                {effectiveStatus === "queued" && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="my-3 w-fit"
                  >
                    <QueuePositionBadge
                      position={infraData?.queue?.position ?? 1}
                      backlogCount={infraData?.queue?.backlogCount ?? 1}
                      activeConsumers={infraData?.queue?.activeConsumers ?? 2}
                      estimatedWaitMs={infraData?.queue?.estimatedWaitMs ?? 0}
                      status="queued"
                      className="px-3 py-1.5 text-xs"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Loading Indicator */}
              <AnimatePresence>
                {sending &&
                  effectiveStatus !== "queued" &&
                  !streamingTokens &&
                  !toolStdout && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-950 border border-white/8 text-zinc-400 text-xs w-fit my-3 font-mono"
                    >
                      <Loader2
                        size={13}
                        className="animate-spin text-zinc-400"
                      />
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
                  <AlertCircle size={15} className="text-rose-400 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Floating scroll to latest button */}
              {showScrollBottomBtn && (
                <div className="sticky bottom-2 flex justify-center pointer-events-none z-20">
                  <button
                    type="button"
                    onClick={() => {
                      isAtBottomRef.current = true;
                      setShowScrollBottomBtn(false);
                      scrollToBottom(true);
                    }}
                    className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/10 shadow-lg text-xs font-mono backdrop-blur-md transition-all cursor-pointer"
                  >
                    <ChevronDown size={14} />
                    <span>Scroll to latest</span>
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Input Area */}
            <div className="p-6 pt-0 z-10 shrink-0">
              <div className="max-w-3xl mx-auto w-full space-y-3">
                <RoleModelPicker
                  selectedRole={selectedRole}
                  selectedModel={selectedModel}
                  onRoleChange={setSelectedRole}
                  onModelChange={setSelectedModel}
                />
                <PromptInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => {
                    void handleSubmit();
                  }}
                  isLoading={sending}
                  placeholder="Type a goal or command for the Crucible agent..."
                  disabled={sending}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Right Preview Column in Split Mode */}
          {previewLayout === "split" && (
            <div className="w-1/2 min-w-[360px] h-full overflow-hidden border-l border-white/8">
              <LivePreviewPane
                sessionId={session.id}
                previewUrl={orchestratorClient.getPreviewUrl(session.id)}
                previewInfo={previewInfo}
                messages={messages}
                onRestart={async () => {
                  await orchestratorClient.startPreview(session.id);
                  const res = await orchestratorClient.getPreviewStatus(
                    session.id,
                  );
                  setPreviewInfo(res.preview);
                }}
                onClose={() => setPreviewLayout("chat")}
              />
            </div>
          )}
        </div>
      )}

      {/* Sandbox Isolation & Resource Budget Modal */}
      <SandboxInfoPanel
        isOpen={showSandboxInfo}
        onClose={() => setShowSandboxInfo(false)}
        sessionId={session.id}
      />

      {/* Live Cross-Session Feed Slide-over / Modal */}
      {showInterSessionFeed && (
        <div className="absolute right-4 bottom-20 z-40 w-96 max-w-[calc(100vw-2rem)] shadow-2xl">
          <InterSessionFeed
            sessions={session ? [session] : []}
            activeSessionId={session.id}
            isOpen={showInterSessionFeed}
            onClose={() => setShowInterSessionFeed(false)}
          />
        </div>
      )}
    </main>
  );
}
