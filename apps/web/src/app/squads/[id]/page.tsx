"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  orchestratorClient,
  type SquadInfo,
} from "../../../api/orchestrator-client";
import { useSessionStore } from "../../../stores/session-store";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { SquadBoard } from "@/components/squads/SquadBoard";
import { type Finding } from "@/components/squads/FindingCard";
import { readTenantScope } from "../../../config/tenant-scope";
import { ArrowLeft, Layers, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default function SquadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const squadId = params.id as string;

  const [squad, setSquad] = React.useState<SquadInfo | null>(null);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());

  const fetchSquadData = React.useCallback(async () => {
    try {
      const { squad: fetchedSquad } =
        await orchestratorClient.getSquad(squadId);
      setSquad(fetchedSquad);

      // Extract Bug Hunter findings or QA test issues from squad transitions/history
      const extractedFindings: Finding[] = [];
      if (fetchedSquad.history) {
        fetchedSquad.history.forEach((h, idx) => {
          if (
            h.triggerRole === "bug_hunter" ||
            h.toStage === "fixing" ||
            h.reason.toLowerCase().includes("vulnerability") ||
            h.reason.toLowerCase().includes("finding")
          ) {
            extractedFindings.push({
              id: `finding_${squadId}_${idx}`,
              title: h.reason || "Security or QA finding detected",
              severity: h.reason.toLowerCase().includes("critical")
                ? "critical"
                : h.reason.toLowerCase().includes("high")
                  ? "high"
                  : "medium",
              status:
                fetchedSquad.stage === "completed"
                  ? "resolved"
                  : fetchedSquad.stage === "fixing"
                    ? "being_fixed"
                    : "open",
              discoveredBy: h.triggerRole || "bug_hunter",
              details:
                typeof h.reason === "string"
                  ? h.reason
                  : JSON.stringify(h.reason),
              timestamp: h.timestamp,
              fixedInIteration: fetchedSquad.fixIterationCount,
            });
          }
        });
      }

      setFindings(extractedFindings);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load squad workflow details.");
    } finally {
      setLoading(false);
    }
  }, [squadId]);

  // Initial load and periodic polling for real-time state machine sync
  React.useEffect(() => {
    void fetchSquadData();
    const interval = setInterval(() => {
      void fetchSquadData();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchSquadData]);

  // Initial session list sync
  React.useEffect(() => {
    orchestratorClient
      .listSessionsWithScope(activeScope)
      .then(setSessions)
      .catch(() => {});
  }, [setSessions, activeScope]);

  const handleStartSquad = async (goal: string) => {
    try {
      const res = await orchestratorClient.startSquad(squadId, goal);
      setSquad(res.squad);
    } catch (err: any) {
      setError(err?.message || "Failed to start squad workflow.");
    }
  };

  const handleTransition = async (stage: string, reason: string) => {
    try {
      const res = await orchestratorClient.transitionSquad(
        squadId,
        stage,
        reason,
      );
      setSquad(res.squad);
    } catch (err: any) {
      setError(err?.message || "Failed to transition squad stage.");
    }
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100 font-sans">
        <Sidebar
          className="border-r border-white/8 bg-zinc-900"
          collapsible="icon"
        >
          <SessionSidebar
            sessions={sessions}
            onCreateSession={async () => {
              const sess = await orchestratorClient.createSession(
                undefined,
                undefined,
                activeScope,
              );
              setSessions(
                await orchestratorClient.listSessionsWithScope(activeScope),
              );
              router.push(`/workspace/session/${sess.id}`);
            }}
            onDeleteSession={async (id) => {
              await orchestratorClient.deleteSession(id);
              setSessions(
                await orchestratorClient.listSessionsWithScope(activeScope),
              );
            }}
            tenantId={activeScope.tenantId}
            namespace={activeScope.namespace}
            onScopeChange={(next) => {
              setActiveScope(next);
            }}
          />
        </Sidebar>

        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
          {/* Top Header */}
          <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/90 backdrop-blur-md z-10 font-mono">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
              <Separator
                orientation="vertical"
                className="h-4 bg-white/10 mx-1"
              />
              <Link
                href="/squads"
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                title="Back to All Squads"
              >
                <ArrowLeft size={14} />
              </Link>
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-sky-400" />
                <h1 className="text-sm font-semibold text-white tracking-tight">
                  Squad Dashboard: {squad?.name || squadId}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/squads"
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                All Squads
              </Link>
            </div>
          </header>

          {/* Squad Board View */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {loading && !squad ? (
              <div className="flex flex-col items-center justify-center h-64 font-mono text-zinc-400 gap-2">
                <Loader2 size={24} className="animate-spin text-sky-400" />
                <span className="text-xs">
                  Connecting to Squad State Machine...
                </span>
              </div>
            ) : error && !squad ? (
              <div className="p-6 rounded-lg border border-rose-500/30 bg-rose-950/30 text-rose-300 font-mono text-xs space-y-2">
                <div className="font-bold">Error loading squad</div>
                <div>{error}</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchSquadData()}
                  className="mt-2 text-xs"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <SquadBoard
                squad={squad || undefined}
                findings={findings}
                onStartSquad={handleStartSquad}
                onTransition={handleTransition}
                isLoading={loading}
              />
            )}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
