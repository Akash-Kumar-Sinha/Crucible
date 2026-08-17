"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { SessionSummary, TenantScope } from "@/api/orchestrator-client";
import {
  Plus,
  Search,
  MessageSquare,
  Activity,
  ShieldAlert,
  Settings,
  MoreHorizontal,
  Copy,
  Check,
  Trash2,
  Terminal,
  Loader2,
} from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { orchestratorClient } from "@/api/orchestrator-client";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import { SetupWizard } from "@/components/sidebar/SetupWizard";
import {
  CommandPalette,
  useCommandPalette,
  type Command,
} from "@/components/ui/command-palette";
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onCreateSession: () => Promise<void> | void;
  onDeleteSession: (id: string) => Promise<void> | void;
  loading?: boolean;
  tenantId?: string;
  namespace?: string;
  onScopeChange?: (scope: TenantScope) => void;
}

const scrollbar = cn(
  "[scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent]",
  "[&::-webkit-scrollbar]:w-1",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10",
  "hover:[&::-webkit-scrollbar-thumb]:bg-white/20",
);

export function SessionSidebar({
  sessions = [],
  activeSessionId,
  onCreateSession,
  onDeleteSession,
  loading: _loading = false,
  tenantId: _tenantId = "default",
  namespace = "crucible",
  onScopeChange,
}: SessionSidebarProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const [isSetupOpen, setIsSetupOpen] = React.useState(false);
  const activeRunningSessionIds = useSessionStore(
    (s) => s.activeRunningSessionIds,
  );
  const setSessions = useSessionStore((s) => s.setSessions);

  React.useEffect(() => {
    const timer = setInterval(() => {
      orchestratorClient
        .listSessionsWithScope({ tenantId: _tenantId, namespace })
        .then(setSessions)
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [_tenantId, namespace, setSessions]);

  const parseTimestamp = (value: unknown): number => {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };

  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => {
      const timeB = parseTimestamp(b.updatedAt || b.createdAt);
      const timeA = parseTimestamp(a.updatedAt || a.createdAt);
      return timeB - timeA;
    });
  }, [sessions]);

  const handleCreate = async () => {
    if (creating) return;
    try {
      setCreating(true);
      await onCreateSession();
    } finally {
      setCreating(false);
    }
  };

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const commands: Command[] = [
    {
      id: "action-new-session",
      label: "New Agent Session",
      description: "Create and initialize an autonomous session",
      group: "Actions",
      icon: <Plus size={16} />,
      onSelect: () => void handleCreate(),
    },
    {
      id: "nav-session",
      label: "Agent Session",
      description: "Return to active conversational session",
      group: "Navigation",
      icon: <Terminal size={16} />,
      onSelect: () => router.push("/workspace/session"),
    },
    {
      id: "nav-metrics",
      label: "Metrics & Traces",
      description: "View telemetry, performance spans, and token budgets",
      group: "Navigation",
      icon: <Activity size={16} />,
      onSelect: () => router.push("/metrics"),
    },
    {
      id: "nav-audit",
      label: "Security Audit Log",
      description: "Inspect Bug Hunter cryptographic SHA-256 hash chains",
      group: "Navigation",
      icon: <ShieldAlert size={16} />,
      onSelect: () => router.push("/audit"),
    },
    ...sessions.map((session) => ({
      id: `session-${session.id}`,
      label: session.title || session.id,
      description: session.status,
      group: "Sessions",
      icon: <MessageSquare size={16} />,
      onSelect: () => router.push(`/workspace/session/${session.id}`),
    })),
  ];

  const platformNavItems = [
    {
      label: "Session",
      icon: MessageSquare,
      href: "/workspace/session",
      isActive: pathname.startsWith("/workspace/session"),
    },
    {
      label: "Metrics",
      icon: Activity,
      href: "/metrics",
      isActive: pathname.startsWith("/metrics"),
    },
    {
      label: "Audit Log",
      icon: ShieldAlert,
      href: "/audit",
      isActive: pathname.startsWith("/audit"),
    },
  ];

  return (
    <>
      <SidebarHeader className="border-b border-white/5 p-3 flex flex-col group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:items-center shrink-0">
        <Link
          href="/workspace/session"
          className="flex items-center gap-2.5 px-1 py-0.5 w-full group select-none text-decoration-none group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
        >
          <Logo className="w-6 h-6 shrink-0 text-white group-hover:scale-105 transition-transform" />
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <CrucibleWordmark className="text-sm tracking-tight" />
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="p-2 flex flex-col min-h-0 flex-1 overflow-hidden group-data-[collapsible=icon]:p-2">
        {/* Top Static Group: Actions and Platform Views */}
        <div className="space-y-3 shrink-0">
          <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:items-center">
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                <SidebarMenuButton
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  tooltip="New Session"
                  className="w-full justify-start gap-2.5 text-xs font-medium text-zinc-100 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
                >
                  <Plus size={14} className="shrink-0 text-zinc-300" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    {creating ? "Creating..." : "New Session"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                <SidebarMenuButton
                  onClick={() => setCommandOpen(true)}
                  tooltip="Search (⌘K)"
                  className="w-full justify-between text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg transition-colors group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
                >
                  <Search size={14} className="shrink-0 text-zinc-400" />
                  <span className="group-data-[collapsible=icon]:hidden flex-1 text-left">
                    Search
                  </span>
                  <span className="rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] font-mono text-zinc-400 group-data-[collapsible=icon]:hidden">
                    ⌘K
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:items-center">
            <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:items-center">
              {platformNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem
                    key={item.href}
                    className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center"
                  >
                    <SidebarMenuButton
                      onClick={() => router.push(item.href)}
                      tooltip={item.label}
                      className={`gap-2.5 text-xs rounded-lg transition-colors group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center ${
                        item.isActive
                          ? "bg-white/10 text-white font-medium"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      }`}
                    >
                      <Icon
                        size={14}
                        className={`shrink-0 ${
                          item.isActive ? "text-white" : "text-zinc-400"
                        }`}
                      />
                      <span className="group-data-[collapsible=icon]:hidden">
                        {item.label}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </div>

        {/* Dedicated Independently Scrollable Recent Sessions Section */}
        <SidebarGroup className="flex-1 min-h-0 flex flex-col group-data-[collapsible=icon]:hidden p-0 pt-2 border-t border-white/5 mt-1">
          <div className="flex items-center justify-between px-2 py-1 shrink-0">
            <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-zinc-500">
              Recent
            </span>
          </div>

          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto pr-1 mt-0.5 space-y-0.5",
              scrollbar,
            )}
          >
            <SidebarMenu className="space-y-0.5">
              {sortedSessions.length === 0 ? (
                <div className="px-2 py-3 text-xs text-zinc-600 font-mono">
                  No sessions yet
                </div>
              ) : (
                sortedSessions.map((s) => {
                  const isActive = activeSessionId === s.id;
                  const isRunning =
                    s.status === "running" ||
                    s.status === "queued" ||
                    Boolean(
                      activeRunningSessionIds[s.id] &&
                      activeRunningSessionIds[s.id].status === "running",
                    );
                  return (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        onClick={() =>
                          router.push(`/workspace/session/${s.id}`)
                        }
                        className={`gap-2 text-xs rounded-lg transition-colors ${
                          isActive
                            ? "bg-white/10 text-white font-medium shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                        }`}
                      >
                        {isRunning ? (
                          <Loader2
                            size={13}
                            className="shrink-0 animate-spin text-blue-400"
                          />
                        ) : (
                          <MessageSquare
                            size={13}
                            className="shrink-0 opacity-70"
                          />
                        )}
                        <span className="truncate flex-1">
                          {s.title || `Session ${s.id.slice(-6)}`}
                        </span>
                        {isRunning && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            active
                          </span>
                        )}
                      </SidebarMenuButton>

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <SidebarMenuAction
                              showOnHover
                              className="text-zinc-500 hover:text-zinc-200"
                            />
                          }
                        >
                          <MoreHorizontal size={13} />
                          <span className="sr-only">Session Options</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          className="w-40 rounded-lg bg-zinc-900 border-white/10 text-xs"
                          side={isMobile ? "bottom" : "right"}
                          align="start"
                        >
                          <DropdownMenuItem
                            onClick={(e) => handleCopyId(s.id, e)}
                            className="gap-2 cursor-pointer text-zinc-300 hover:text-white"
                          >
                            {copiedId === s.id ? (
                              <Check size={13} className="text-emerald-400" />
                            ) : (
                              <Copy size={13} />
                            )}
                            <span>
                              {copiedId === s.id ? "Copied ID" : "Copy ID"}
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/5" />
                          <DropdownMenuItem
                            onClick={async () => {
                              await onDeleteSession(s.id);
                            }}
                            className="gap-2 cursor-pointer text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                          >
                            <Trash2 size={13} />
                            <span>Delete Session</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </div>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-white/5 p-2 flex flex-col group-data-[collapsible=icon]:items-center shrink-0">
        <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              onClick={() => setIsSetupOpen(true)}
              tooltip="Cluster Settings"
              className="gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg p-2 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center transition-colors"
            >
              <Avatar className="h-5 w-5 rounded-md border border-white/10 shrink-0">
                <AvatarFallback className="bg-zinc-800 text-[9px] font-mono text-zinc-300">
                  CR
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium text-zinc-200">
                  Crucible Cluster
                </span>
                <span className="truncate text-[10px] text-zinc-500 font-mono">
                  {namespace}
                </span>
              </div>
              <Settings
                size={13}
                className="text-zinc-500 shrink-0 group-data-[collapsible=icon]:hidden"
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        commands={commands}
      />

      <SetupWizard
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        onConfigSaved={({
          tenantId: nextTenantId,
          namespace: nextNamespace,
        }) => {
          onScopeChange?.({ tenantId: nextTenantId, namespace: nextNamespace });
        }}
      />
    </>
  );
}
