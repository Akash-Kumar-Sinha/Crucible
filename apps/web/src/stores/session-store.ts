import { create } from "zustand";
import type {
  AgentMessage,
  SessionDetail,
  SessionSummary,
  ToolCall,
} from "../api/orchestrator-client";

export type AgentState =
  | "awaiting_model"
  | "awaiting_tool"
  | "awaiting_human"
  | "done"
  | "error";

export type SessionStatus =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "error"
  | "awaiting_human";

export interface SessionStoreState {
  currentSessionId: string | null;
  currentSession: SessionDetail | null;
  sessions: SessionSummary[];
  status: SessionStatus;
  agentState: AgentState;
  isSending: boolean;
  isLoading: boolean;
  error: string | null;

  // Real-Time Streaming State
  streamingThought: string;
  streamingTokens: string;
  activeToolCalls: ToolCall[];
  toolStdout: string;
  toolStderr: string;
  isStreamConnected: boolean;

  // Actions
  setCurrentSessionId: (id: string | null) => void;
  setCurrentSession: (session: SessionDetail | null) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  addSessionToList: (session: SessionSummary) => void;
  removeSessionFromList: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
  addMessageToCurrentSession: (msg: AgentMessage) => void;
  setStatus: (status: SessionStatus) => void;
  setAgentState: (agentState: AgentState) => void;
  setSending: (isSending: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Streaming Actions
  setStreamingThought: (thought: string) => void;
  appendStreamingThought: (chunk: string) => void;
  appendStreamingTokens: (chunk: string) => void;
  setActiveToolCalls: (calls: ToolCall[]) => void;
  appendToolStdout: (chunk: string) => void;
  appendToolStderr: (chunk: string) => void;
  setStreamConnected: (connected: boolean) => void;
  clearStreamingState: () => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  currentSessionId: null,
  currentSession: null,
  sessions: [],
  status: "idle",
  agentState: "awaiting_model",
  isSending: false,
  isLoading: false,
  error: null,

  streamingThought: "",
  streamingTokens: "",
  activeToolCalls: [],
  toolStdout: "",
  toolStderr: "",
  isStreamConnected: false,

  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  setCurrentSession: (currentSession) =>
    set({
      currentSession,
      status: (currentSession?.status as SessionStatus) || "idle",
    }),
  setSessions: (sessions) => set({ sessions }),
  addSessionToList: (session) =>
    set((prev) => ({
      sessions: [session, ...prev.sessions.filter((s) => s.id !== session.id)],
    })),
  removeSessionFromList: (id) =>
    set((prev) => ({
      sessions: prev.sessions.filter((s) => s.id !== id),
      currentSession:
        prev.currentSession?.id === id ? null : prev.currentSession,
      currentSessionId:
        prev.currentSessionId === id ? null : prev.currentSessionId,
    })),
  updateSessionTitle: (id, title) =>
    set((prev) => ({
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
      currentSession:
        prev.currentSession?.id === id
          ? {
              ...prev.currentSession,
              title,
              metadata: { ...prev.currentSession.metadata, title },
            }
          : prev.currentSession,
    })),
  addMessageToCurrentSession: (msg) =>
    set((prev) => {
      if (!prev.currentSession) return prev;
      const existing = prev.currentSession.messages;
      // Deduplicate only against the most recent message to allow recurring responses/turns
      const isDuplicate = existing.some((m, idx) => {
        if (idx !== existing.length - 1) return false;
        if (msg.toolCallId && m.toolCallId && msg.toolCallId === m.toolCallId)
          return true;
        const sameRole = m.role === msg.role;
        const sameContent =
          (m.content || "").trim() === (msg.content || "").trim();
        const sameThought =
          (m.thought || "").trim() === (msg.thought || "").trim();
        const mTools = m.toolCalls || [];
        const msgTools = msg.toolCalls || [];
        const sameTools =
          mTools.length === 0 && msgTools.length === 0
            ? true
            : JSON.stringify(mTools) === JSON.stringify(msgTools);
        return sameRole && sameContent && sameThought && sameTools;
      });
      if (isDuplicate) return prev;
      return {
        currentSession: {
          ...prev.currentSession,
          messages: [...existing, msg],
        },
      };
    }),
  setStatus: (status) =>
    set((prev) => ({
      status,
      currentSession: prev.currentSession
        ? { ...prev.currentSession, status }
        : null,
    })),
  setAgentState: (agentState) => set({ agentState }),
  setSending: (isSending) => set({ isSending }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setStreamingThought: (streamingThought) => set({ streamingThought }),
  appendStreamingThought: (chunk) =>
    set((prev) => ({ streamingThought: prev.streamingThought + chunk })),
  appendStreamingTokens: (chunk) =>
    set((prev) => ({ streamingTokens: prev.streamingTokens + chunk })),
  setActiveToolCalls: (activeToolCalls) => set({ activeToolCalls }),
  appendToolStdout: (chunk) =>
    set((prev) => ({ toolStdout: prev.toolStdout + chunk })),
  appendToolStderr: (chunk) =>
    set((prev) => ({ toolStderr: prev.toolStderr + chunk })),
  setStreamConnected: (isStreamConnected) => set({ isStreamConnected }),
  clearStreamingState: () =>
    set({
      streamingThought: "",
      streamingTokens: "",
      activeToolCalls: [],
      toolStdout: "",
      toolStderr: "",
    }),
  reset: () =>
    set({
      currentSessionId: null,
      currentSession: null,
      status: "idle",
      agentState: "awaiting_model",
      isSending: false,
      isLoading: false,
      error: null,
      streamingThought: "",
      streamingTokens: "",
      activeToolCalls: [],
      toolStdout: "",
      toolStderr: "",
      isStreamConnected: false,
    }),
}));
