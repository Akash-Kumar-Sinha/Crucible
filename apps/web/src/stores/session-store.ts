import { create } from "zustand";
import type {
  AgentMessage,
  SessionDetail,
  SessionSummary,
  ToolCall,
} from "../api/orchestrator-client";

export interface SessionStoreState {
  currentSessionId: string | null;
  currentSession: SessionDetail | null;
  sessions: SessionSummary[];
  status: "idle" | "running" | "done" | "error" | "awaiting_human";
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
  addMessageToCurrentSession: (msg: AgentMessage) => void;
  setStatus: (status: SessionStoreState["status"]) => void;
  setSending: (isSending: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Streaming Actions
  setStreamingThought: (thought: string) => void;
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
      status: (currentSession?.status as SessionStoreState["status"]) || "idle",
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
  addMessageToCurrentSession: (msg) =>
    set((prev) => {
      if (!prev.currentSession) return prev;
      return {
        currentSession: {
          ...prev.currentSession,
          messages: [...prev.currentSession.messages, msg],
        },
      };
    }),
  setStatus: (status) => set({ status }),
  setSending: (isSending) => set({ isSending }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setStreamingThought: (streamingThought) => set({ streamingThought }),
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
