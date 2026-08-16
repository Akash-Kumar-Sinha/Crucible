"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SessionSummary, TenantScope } from "@/api/orchestrator-client";
import {
  Plus,
  Search,
  Activity,
  Layers,
  ShieldAlert,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  Copy,
  Check,
  Settings,
} from "lucide-react";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import { SetupWizard } from "@/components/sidebar/SetupWizard";
import {
  CommandPalette,
  useCommandPalette,
  type Command,
} from "@/components/ui/command-palette";
import { TenantSwitcher } from "@/components/sidebar/TenantSwitcher";
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
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

export function SessionSidebar({
  sessions = [],
  activeSessionId,
  onCreateSession,
  onDeleteSession,
  loading = false,
  tenantId = "default",
  namespace = "crucible",
  onScopeChange,
}: SessionSidebarProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSetupOpen, setIsSetupOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();

  const handleCreate = async () => {
    setCreating(true);
    setErrorMessage(null);
    try {
      await onCreateSession();
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          "Failed to create session. Please check if 'make serve' is running on port 4000.",
      );
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

  const filteredSessions = React.useMemo(() => {
    const getTime = (val: any): number => {
      if (!val) return 0;
      if (typeof val === "number") return val;
      if (val instanceof Date) return val.getTime();
      return new Date(val).getTime() || 0;
    };
    return [...sessions]
      .filter((s) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          (s.title && s.title.toLowerCase().includes(q)) ||
          s.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const timeA = getTime(a.updatedAt || a.createdAt);
        const timeB = getTime(b.updatedAt || b.createdAt);
        if (timeB !== timeA) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });
  }, [sessions, searchQuery]);

  const commands: Command[] = [
    {
      id: "action-new-session",
      label: "New Agent Session",
      description: "Initialize a new autonomous agent session",
      group: "Actions",
      icon: <Plus size={16} />,
      onSelect: () => void handleCreate(),
    },
    {
      id: "action-setup-wizard",
      label: "Setup Wizard & Cluster Config",
      description: "Configure multi-tenant isolation, Redis, and LLM backend",
      group: "Actions",
      icon: <Settings size={16} />,
      onSelect: () => setIsSetupOpen(true),
    },
    {
      id: "nav-metrics",
      label: "Metrics & Observability Dashboard",
      description: "Explore W3C distributed traces, spans, and throughput",
      group: "Navigation",
      icon: <Activity size={16} />,
      onSelect: () => router.push("/metrics"),
    },
    {
      id: "nav-squads",
      label: "Multi-Agent Squads",
      description: "Manage 4-stage automated pipelines",
      group: "Navigation",
      icon: <Layers size={16} />,
      onSelect: () => router.push("/squads"),
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

  return (
    <>
      {/* 1. Header: Brand & Scope Switcher */}
      <SidebarHeader className="border-b border-white/8 p-2 space-y-3 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:space-y-0 flex flex-col group-data-[collapsible=icon]:items-center">
        <Link
          href="/workspace"
          className="flex items-center gap-2.5 px-1 py-1 w-full group select-none text-decoration-none group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
        >
          <Logo className="w-7 h-7 shrink-0 text-white group-hover:scale-105 transition-transform" />
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <CrucibleWordmark className="text-sm" />
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest leading-none">
              Orchestrator
            </span>
          </div>
        </Link>


      </SidebarHeader>

      {/* 2. Content: Actions, Platform Nav & Active Sessions */}
      <SidebarContent className="p-2 space-y-2 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:space-y-2">
        {/* Quick Actions */}
        <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:items-center">
          <SidebarGroupLabel className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500 px-2 group-data-[collapsible=icon]:hidden">
            Quick Actions
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                onClick={() => void handleCreate()}
                disabled={creating}
                tooltip="New Agent Session"
                className="w-full justify-start gap-2.5 text-xs font-medium text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/8 rounded-lg group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
              >
                <Plus size={14} className="shrink-0 text-zinc-400" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {creating ? "Creating..." : "New Agent Session"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                onClick={() => setCommandOpen(true)}
                tooltip="Search & Actions (⌘K)"
                className="w-full justify-between text-xs text-zinc-400 hover:text-zinc-200 rounded-lg group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
              >
                <Search size={14} className="shrink-0 text-zinc-500" />
                <span className="group-data-[collapsible=icon]:hidden flex-1 text-left">
                  Search & Actions
                </span>
                <span className="rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] font-mono text-zinc-400 group-data-[collapsible=icon]:hidden">
                  ⌘K
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {errorMessage && (
            <div className="mt-2 px-2 py-1 text-[10px] text-rose-300 bg-rose-950/50 rounded-md border border-rose-500/30 group-data-[collapsible=icon]:hidden">
              {errorMessage}
            </div>
          )}
        </SidebarGroup>


        {/* Active Sessions List (Hidden when sidebar is collapsed/closed) */}
        <SidebarGroup className="flex-1 group-data-[collapsible=icon]:hidden p-0">
          <div className="flex items-center justify-between px-2 py-1">
            <SidebarGroupLabel className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500 p-0">
              Active Sessions ({sessions.length})
            </SidebarGroupLabel>
            <SidebarGroupAction
              onClick={() => void handleCreate()}
              title="New Session"
            >
              <Plus size={12} />
            </SidebarGroupAction>
          </div>

          {sessions.length > 5 && (
            <div className="px-2 py-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter sessions..."
                className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-white/20"
              />
            </div>
          )}

          <SidebarMenu className="mt-1 space-y-0.5">
            {filteredSessions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500 font-mono">
                {searchQuery ? "No matching sessions" : "No active sessions"}
              </div>
            ) : (
              filteredSessions.map((s) => {
                const isActive = activeSessionId === s.id;
                return (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton
                      onClick={() => router.push(`/workspace/session/${s.id}`)}
                      className={`gap-2 text-xs font-mono rounded-lg transition-colors ${
                        isActive
                          ? "bg-white/10 text-white font-medium shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      }`}
                    >
                      <MessageSquare
                        size={13}
                        className={`shrink-0 ${
                          isActive ? "text-white" : "text-zinc-500"
                        }`}
                      />
                      <span className="truncate flex-1">
                        {s.title || `Session ${s.id.slice(-6)}`}
                      </span>
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
                        className="w-44 rounded-lg bg-zinc-900 border-white/10 text-xs"
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
                            {copiedId === s.id ? "Copied ID!" : "Copy ID"}
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
        </SidebarGroup>

        {/* Platform Workflows */}
        <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:items-center">
          <SidebarGroupLabel className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500 px-2 group-data-[collapsible=icon]:hidden">
            Platform Views
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                onClick={() => router.push("/metrics")}
                tooltip="Metrics & Traces"
                className="gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
              >
                <Activity size={14} className="shrink-0 text-zinc-500" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Metrics & Traces
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                onClick={() => router.push("/squads")}
                tooltip="Multi-Agent Squads"
                className="gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
              >
                <Layers size={14} className="shrink-0 text-zinc-500" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Multi-Agent Squads
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                onClick={() => router.push("/audit")}
                tooltip="Security Audit Log"
                className="gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
              >
                <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Security Audit Log
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>


        </SidebarGroup>

        <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                 <TenantSwitcher
                   tenantId={tenantId}
                   namespace={namespace}
                   onScopeChange={(scope) => {
                     onScopeChange?.(scope);
                   }}
                 />
               </SidebarMenuItem>

        </SidebarGroup>
      </SidebarContent>

      {/* 3. Footer: User / Setup Launcher */}
      <SidebarFooter className="border-t border-white/8 p-2 flex flex-col group-data-[collapsible=icon]:items-center">
        <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              onClick={() => setIsSetupOpen(true)}
              tooltip="Cluster Settings"
              className="gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-lg p-2 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center flex items-center"
            >
              <Avatar className="h-6 w-6 rounded-md border border-white/10 shrink-0">
                <AvatarFallback className="bg-zinc-800 text-[10px] text-zinc-300">
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
        placeholder="Search sessions and actions..."
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
