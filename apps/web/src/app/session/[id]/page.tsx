"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { orchestratorClient } from "../../../api/orchestrator-client";
import { useSessionStore } from "../../../stores/session-store";
import { SessionSidebar } from "../../../components/SessionSidebar";
import { ChatWindow } from "../../../components/ChatWindow";

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  // Zustand atomic selective subscriptions
  const session = useSessionStore((s) => s.currentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useSessionStore((s) => s.isLoading);
  const sending = useSessionStore((s) => s.isSending);
  const error = useSessionStore((s) => s.error);

  const setCurrentSessionId = useSessionStore((s) => s.setCurrentSessionId);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setSessions = useSessionStore((s) => s.setSessions);
  const addSessionToList = useSessionStore((s) => s.addSessionToList);
  const addMessageToCurrentSession = useSessionStore(
    (s) => s.addMessageToCurrentSession,
  );
  const setLoading = useSessionStore((s) => s.setLoading);
  const setSending = useSessionStore((s) => s.setSending);
  const setError = useSessionStore((s) => s.setError);
  const removeSessionFromList = useSessionStore((s) => s.removeSessionFromList);

  // Synchronizing session data with effect cleanup and AbortController
  React.useEffect(() => {
    if (!sessionId) return;
    setCurrentSessionId(sessionId);
    setLoading(true);
    setError(null);

    let isSubscribed = true;

    async function loadData() {
      try {
        const [sessionDetail, sessionList] = await Promise.all([
          orchestratorClient.getSession(sessionId),
          orchestratorClient.listSessions(),
        ]);

        if (isSubscribed) {
          setCurrentSession(sessionDetail);
          setSessions(sessionList);
        }
      } catch (err: any) {
        if (isSubscribed) {
          setError(
            err?.message ||
              `Failed to load session '${sessionId}'. Make sure orchestrator is running on port 4000.`,
          );
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isSubscribed = false;
    };
  }, [
    sessionId,
    setCurrentSessionId,
    setCurrentSession,
    setSessions,
    setLoading,
    setError,
  ]);

  // Polling synchronization while in running state
  React.useEffect(() => {
    if (!session || session.status !== "running") return;

    let isSubscribed = true;
    const interval = setInterval(async () => {
      try {
        const updated = await orchestratorClient.getSession(sessionId);
        if (isSubscribed) {
          setCurrentSession(updated);
        }
      } catch {
        // ignore background poll errors
      }
    }, 1500);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [sessionId, session, setCurrentSession]);

  const handleSendMessage = async (message: string) => {
    setSending(true);
    setError(null);

    // Optimistically update message stream in Zustand store
    addMessageToCurrentSession({ role: "user", content: message });

    try {
      await orchestratorClient.sendMessage(sessionId, message);
      const [updatedSession, updatedList] = await Promise.all([
        orchestratorClient.getSession(sessionId),
        orchestratorClient.listSessions(),
      ]);
      setCurrentSession(updatedSession);
      setSessions(updatedList);
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to dispatch message to orchestrator. Check your API key and connection.",
      );
      try {
        const refreshed = await orchestratorClient.getSession(sessionId);
        setCurrentSession(refreshed);
      } catch {
        // ignore
      }
    } finally {
      setSending(false);
    }
  };

  const handleCreateSession = async () => {
    try {
      setError(null);
      const created = await orchestratorClient.createSession();
      addSessionToList({
        id: created.id,
        title: created.title,
        status: created.status,
        agentState: "awaiting_model",
        messageCount: 0,
        stepCount: 0,
        turnCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      });
      router.push(`/session/${created.id}`);
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to create new session. Run 'make serve' to start backend on port 4000.",
      );
      throw err;
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await orchestratorClient.deleteSession(id);
      removeSessionFromList(id);
      if (id === sessionId) {
        router.push("/workspace");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to delete session.");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        loading={loading}
      />
      <ChatWindow
        session={session}
        onSendMessage={handleSendMessage}
        loading={loading}
        error={error}
      />
    </div>
  );
}
