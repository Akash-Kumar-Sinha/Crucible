import { create } from "zustand";
import type {
  AgentMessage,
  SessionDetail,
  SessionSummary,
} from "../api/orchestrator-client";

export interface SessionStoreState {
  currentSessionId: string | null;
  currentSession: SessionDetail | null;
  sessions: SessionSummary[];
  status: "idle" | "running" | "done" | "error" | "awaiting_human";
  isSending: boolean;
  isLoading: boolean;
  error: string | null;

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
  reset: () =>
    set({
      currentSessionId: null,
      currentSession: null,
      status: "idle",
      isSending: false,
      isLoading: false,
      error: null,
    }),
}));
