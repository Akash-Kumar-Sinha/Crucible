"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { orchestratorClient } from "../../api/orchestrator-client";
import { useSessionStore } from "../../stores/session-store";
import { SessionSidebar } from "../../components/SessionSidebar";
import { ChatWindow } from "../../components/ChatWindow";
import { SetupWizard } from "../../components/SetupWizard";

export default function WorkspacePage() {
  const router = useRouter();
  const [showFirstRunWizard, setShowFirstRunWizard] = React.useState(false);
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useSessionStore((s) => s.isLoading);
  const setSessions = useSessionStore((s) => s.setSessions);
  const addSessionToList = useSessionStore((s) => s.addSessionToList);
  const setLoading = useSessionStore((s) => s.setLoading);
  const removeSessionFromList = useSessionStore((s) => s.removeSessionFromList);
  const setError = useSessionStore((s) => s.setError);
  const error = useSessionStore((s) => s.error);

  const fetchSessions = React.useCallback(async () => {
    try {
      setLoading(true);
      const list = await orchestratorClient.listSessions();
      setSessions(list);
      if (list.length > 0) {
        router.push(`/session/${list[list.length - 1].id}`);
      } else {
        const hasKey =
          typeof window !== "undefined" &&
          Boolean(localStorage.getItem("crucible_api_key"));
        if (!hasKey) {
          setShowFirstRunWizard(true);
        }
      }
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to connect to orchestrator on port 4000. Run 'make serve' to start backend.",
      );
    } finally {
      setLoading(false);
    }
  }, [router, setSessions, setLoading, setError]);

  React.useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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
          "Failed to create session. Run 'make serve' to start the orchestrator.",
      );
      throw err;
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await orchestratorClient.deleteSession(id);
      removeSessionFromList(id);
    } catch (err: any) {
      setError(err?.message || "Failed to delete session.");
    }
  };

  const handleSendMessageFromEmpty = async (text: string) => {
    try {
      setError(null);
      const title = text.length > 30 ? text.slice(0, 30) + "..." : text;
      const created = await orchestratorClient.createSession(title);
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
      // Asynchronously trigger the message on the newly created session
      await orchestratorClient.sendMessage(created.id, text);
    } catch (err: any) {
      setError(err?.message || "Failed to create session and dispatch prompt.");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <SessionSidebar
        sessions={sessions}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        loading={loading}
      />
      <ChatWindow
        session={null}
        onSendMessage={handleSendMessageFromEmpty}
        error={error}
      />
      <SetupWizard
        isOpen={showFirstRunWizard}
        onClose={() => setShowFirstRunWizard(false)}
        isFirstRun={true}
      />
    </div>
  );
}
