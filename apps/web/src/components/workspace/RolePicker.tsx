"use client";

import * as React from "react";
import { orchestratorClient, type RoleInfo } from "@/api/orchestrator-client";
import {
  UserCheck,
  ChevronDown,
  Check,
  ShieldAlert,
  Code2,
  TestTube2,
  Wrench,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface RolePickerProps {
  selectedRole?: string;
  onRoleChange: (roleId: string, defaultModel?: string) => void;
  className?: string;
  disabled?: boolean;
}

const roleIcons: Record<string, React.ReactNode> = {
  coder: <Code2 size={13} className="text-sky-400" />,
  test_writer: <TestTube2 size={13} className="text-emerald-400" />,
  bug_hunter: <ShieldAlert size={13} className="text-rose-400" />,
  bug_fixer: <Wrench size={13} className="text-amber-400" />,
  general: <UserCheck size={13} className="text-zinc-400" />,
};

const DEFAULT_ROLES: RoleInfo[] = [
  {
    id: "coder",
    name: "Coder",
    description:
      "Autonomous software engineer with full workspace write permissions",
    defaultModel: "anthropic/claude-3.5-sonnet",
    allowedTools: [
      "read_file",
      "write_file",
      "bash_exec",
      "grep_search",
      "list_dir",
    ],
    readOnly: false,
    capabilities: ["code_generation", "refactoring", "tool_execution"],
  },
  {
    id: "test_writer",
    name: "Test Writer",
    description:
      "Automated test engineer specializing in unit, integration, and property tests",
    defaultModel: "anthropic/claude-3.5-sonnet",
    allowedTools: [
      "read_file",
      "write_file",
      "bash_exec",
      "grep_search",
      "list_dir",
    ],
    readOnly: false,
    capabilities: ["test_authoring", "regression_testing", "coverage_analysis"],
  },
  {
    id: "bug_hunter",
    name: "Bug Hunter",
    description:
      "Read-only white-hat security auditor running in an air-gapped sandbox",
    defaultModel: "anthropic/claude-3.5-sonnet",
    allowedTools: ["read_file", "grep_search", "list_dir", "calculator"],
    readOnly: true,
    capabilities: [
      "vulnerability_analysis",
      "secret_scanning",
      "audit_logging",
    ],
  },
  {
    id: "bug_fixer",
    name: "Bug Fixer",
    description:
      "Targeted remediation specialist focused on fixing failing tests and security bugs",
    defaultModel: "anthropic/claude-3.5-sonnet",
    allowedTools: [
      "read_file",
      "write_file",
      "bash_exec",
      "grep_search",
      "list_dir",
    ],
    readOnly: false,
    capabilities: ["patch_application", "minimal_diffs", "verification"],
  },
  {
    id: "general",
    name: "General",
    description:
      "General-purpose agent orchestrator for conversational tasks and multi-tool execution",
    defaultModel: "anthropic/claude-3.5-sonnet",
    allowedTools: [
      "read_file",
      "write_file",
      "bash_exec",
      "calculator",
      "current_time",
    ],
    readOnly: false,
    capabilities: ["general_reasoning", "tool_orchestration"],
  },
];

export function RolePicker({
  selectedRole = "coder",
  onRoleChange,
  className = "",
  disabled = false,
}: RolePickerProps) {
  const [roles, setRoles] = React.useState<RoleInfo[]>(DEFAULT_ROLES);

  React.useEffect(() => {
    let isMounted = true;
    orchestratorClient
      .listRoles()
      .then((data) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setRoles(data);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const activeRole = roles.find((r) => r.id === selectedRole) ||
    roles[0] || {
      id: selectedRole,
      name: selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1),
      description: "",
      defaultModel: "anthropic/claude-3.5-sonnet",
      allowedTools: [],
      readOnly: selectedRole === "bug_hunter",
      capabilities: [],
    };

  return (
    <div className={`relative inline-block ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 hover:text-white transition-all text-xs font-mono select-none disabled:opacity-50 outline-none"
        >
          {roleIcons[activeRole.id] || <UserCheck size={12} />}
          <span className="font-medium text-xs whitespace-nowrap">
            {activeRole.name}
          </span>
          <ChevronDown size={12} className="text-zinc-400" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-72 rounded-lg border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-2 z-50 shadow-2xl"
        >
          <DropdownMenuLabel className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Agent Role Archetypes
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-white/5 my-1" />

          <div className="space-y-1">
            {roles.map((role) => {
              const isSelected = role.id === selectedRole;
              return (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => onRoleChange(role.id, role.defaultModel)}
                  className={`w-full text-left p-2 rounded-lg transition-colors flex items-start justify-between gap-2 text-xs font-mono cursor-pointer ${
                    isSelected
                      ? "bg-zinc-800 text-white border border-white/10"
                      : "hover:bg-zinc-800/70 text-zinc-300 hover:text-white"
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span className="mt-0.5 shrink-0">
                      {roleIcons[role.id] || <UserCheck size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs truncate">
                          {role.name}
                        </span>
                        {role.readOnly && (
                          <span className="px-1 py-0.2 bg-rose-500/20 text-rose-300 text-[8px] rounded font-bold uppercase">
                            RO
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5 font-sans leading-relaxed">
                          {role.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check size={14} className="text-sky-400 mt-0.5 shrink-0" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
