"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { orchestratorClient } from "@/api/orchestrator-client";
import { useSessionStore } from "@/stores/session-store";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { ChatWindow } from "@/components/workspace/ChatWindow";
import { readTenantScope } from "@/config/tenant-scope";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
} from "@/components/ui/sidebar";

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());

  // Zustand atomic selective subscriptions
  const session = useSessionStore((s) => s.currentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useSessionStore((s) => s.isLoading);
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

  const initialPromptHandledRef = React.useRef(false);

  const handleSendMessage = React.useCallback(
    async (message: string) => {
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
    },
    [
      sessionId,
      addMessageToCurrentSession,
      setCurrentSession,
      setSessions,
      setSending,
      setError,
    ],
  );

  // Synchronizing session data with effect cleanup and initial prompt handling
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
          orchestratorClient.listSessionsWithScope(activeScope),
        ]);

        if (isSubscribed) {
          setCurrentSession(sessionDetail);
          setSessions(sessionList);

          // Handle initial prompt from searchParams if passed from empty session
          const initialPrompt = searchParams.get("initialPrompt");
          if (initialPrompt && !initialPromptHandledRef.current) {
            initialPromptHandledRef.current = true;
            router.replace(`/workspace/session/${sessionId}`);
            void handleSendMessage(initialPrompt);
          }
        }
      } catch (err: any) {
        if (isSubscribed) {
          setError(
            err?.message ||
              `Failed to load session ${sessionId}. It may have been deleted.`,
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
    activeScope,
    searchParams,
    router,
    handleSendMessage,
    setCurrentSessionId,
    setCurrentSession,
    setSessions,
    setLoading,
    setError,
  ]);

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
      router.push(`/workspace/session/${created.id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create session.");
      throw err;
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await orchestratorClient.deleteSession(id);
      removeSessionFromList(id);
      if (id === sessionId) {
        router.push("/workspace/session");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to delete session.");
    }
  };

  const handleSendMessageFromActive = async (
    text: string,
    model?: string,
    role?: string,
  ) => {
    if (!session) return;
    if (model || role) {
      try {
        await orchestratorClient.updateSessionConfig(sessionId, {
          model,
          role,
        });
      } catch {
        // ignore
      }
    }
    await handleSendMessage(text);
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <Sidebar
          className="border-r border-white/8 bg-zinc-950"
          collapsible="icon"
        >
          <SessionSidebar
            sessions={sessions}
            activeSessionId={sessionId}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            loading={loading}
            tenantId={activeScope.tenantId}
            namespace={activeScope.namespace}
            onScopeChange={setActiveScope}
          />
        </Sidebar>
        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
          <ChatWindow
            session={session}
            onSendMessage={handleSendMessageFromActive}
            error={error}
          />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
