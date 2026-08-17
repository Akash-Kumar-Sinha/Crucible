"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  orchestratorClient,
  type AuditRecord,
  type AuditIntegrityResult,
} from "../../api/orchestrator-client";
import { useSessionStore } from "../../stores/session-store";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { AuditLogTable } from "@/components/audit/AuditLogTable";
import { readTenantScope } from "../../config/tenant-scope";
import { ShieldAlert, Lock, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default function AuditLogPage() {
  const router = useRouter();
  const [records, setRecords] = React.useState<AuditRecord[]>([]);
  const [integrity, setIntegrity] = React.useState<
    AuditIntegrityResult | undefined
  >();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const [activeScope, setActiveScope] = React.useState(() => readTenantScope());

  const fetchAuditData = React.useCallback(async () => {
    try {
      const data = await orchestratorClient.getAuditRecords({ limit: 200 });
      setRecords(data.records || []);
      setIntegrity(data.integrity);
      setError(null);
    } catch (err: any) {
      setError(
        err?.message ||
          "CRITICAL: Failed to retrieve Bug Hunter cryptographic audit trail from orchestrator.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchAuditData();
    const interval = setInterval(() => {
      void fetchAuditData();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchAuditData]);

  React.useEffect(() => {
    orchestratorClient
      .listSessionsWithScope(activeScope)
      .then(setSessions)
      .catch(() => {});
  }, [setSessions, activeScope]);

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
          {/* Header */}
          <header className="h-14 border-b border-white/8 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/90 backdrop-blur-md z-10 font-mono">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="-ml-1 text-zinc-400 hover:text-white" />
              <Separator
                orientation="vertical"
                className="h-4 bg-white/10 mx-1"
              />
              <Link
                href="/workspace/session"
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                title="Back to Session"
              >
                <ArrowLeft size={14} />
              </Link>
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-rose-400" />
                <h1 className="text-sm font-semibold text-white tracking-tight">
                  Adversarial Security Audit Trail
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-bold uppercase">
                <Lock size={10} />
                Bug Hunter Sandbox Ledger
              </span>
            </div>
          </header>

          {/* Audit Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 font-mono">
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    Cryptographic Audit Log
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Append-only, SHA-256 hash-chained event record of all
                    adversarial Bug Hunter probe actions, commands, and sandbox
                    evaluations.
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-lg border border-rose-500/40 bg-rose-950/40 text-rose-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldAlert size={14} />
                    Audit Trail Read Alert
                  </div>
                  <div>{error}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchAuditData()}
                    className="mt-2 text-xs"
                  >
                    Retry Audit Sync
                  </Button>
                </div>
              )}

              {loading && records.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-zinc-400 gap-2">
                  <Loader2 size={24} className="animate-spin text-rose-400" />
                  <span className="text-xs">
                    Verifying cryptographic audit chain...
                  </span>
                </div>
              ) : (
                <AuditLogTable
                  records={records}
                  integrity={integrity}
                  isLoading={loading}
                  onRefresh={fetchAuditData}
                />
              )}
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
