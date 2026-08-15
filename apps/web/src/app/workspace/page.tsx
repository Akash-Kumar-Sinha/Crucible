"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { orchestratorClient } from "../../api/orchestrator-client";
import { useSessionStore } from "../../stores/session-store";
import { SessionSidebar } from "../../components/SessionSidebar";
import { ChatWindow } from "../../components/ChatWindow";
import { SetupWizard } from "../../components/SetupWizard";
import { readTenantScope } from "../../config/tenant-scope";

export default function WorkspacePage() {
  const router = useRouter();
  const [showFirstRunWizard, setShowFirstRunWizard] = React.useState(false);
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());
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
      const list = await orchestratorClient.listSessionsWithScope(activeScope);
      setSessions(list);
      if (list.length === 0) {
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
  }, [router, activeScope, setSessions, setLoading, setError]);

  React.useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCreateSession = async () => {
    try {
      setError(null);
      const created = await orchestratorClient.createSession(
        undefined,
        undefined,
        activeScope,
      );
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
      const title = text.length > 35 ? text.slice(0, 35) + "..." : text;
      const created = await orchestratorClient.createSession(
        title,
        undefined,
        activeScope,
      );
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
      router.push(
        `/session/${created.id}?initialPrompt=${encodeURIComponent(text)}`,
      );
    } catch (err: any) {
      setError(err?.message || "Failed to create session and dispatch prompt.");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      <SessionSidebar
        sessions={sessions}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        loading={loading}
        tenantId={activeScope.tenantId}
        namespace={activeScope.namespace}
        onScopeChange={setActiveScope}
      />
      <ChatWindow
        session={null}
        onSendMessage={handleSendMessageFromEmpty}
        error={error}
      />
      <SetupWizard
        isOpen={showFirstRunWizard}
        onClose={() => setShowFirstRunWizard(false)}
        onConfigSaved={({ tenantId, namespace }) =>
          setActiveScope({ tenantId, namespace })
        }
        isFirstRun={true}
      />
    </div>
  );
}
