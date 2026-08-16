"use client";

import * as React from "react";
import Link from "next/link";
import {
  Code2,
  CheckCircle2,
  ShieldAlert,
  Wrench,
  Bot,
  ExternalLink,
} from "lucide-react";

export interface RoleAvatarProps {
  role:
    "coder" | "test_writer" | "bug_hunter" | "bug_fixer" | "general" | string;
  sessionId?: string;
  model?: string;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  showLink?: boolean;
}

const roleConfig: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    accentColor: string;
    borderClass: string;
    bgClass: string;
    textClass: string;
  }
> = {
  coder: {
    label: "Coder",
    icon: Code2,
    accentColor: "sky",
    borderClass: "border-sky-500/30",
    bgClass: "bg-sky-500/10",
    textClass: "text-sky-300",
  },
  test_writer: {
    label: "Test Writer",
    icon: CheckCircle2,
    accentColor: "emerald",
    borderClass: "border-emerald-500/30",
    bgClass: "bg-emerald-500/10",
    textClass: "text-emerald-300",
  },
  bug_hunter: {
    label: "Bug Hunter",
    icon: ShieldAlert,
    accentColor: "rose",
    borderClass: "border-rose-500/40 ring-1 ring-rose-500/20",
    bgClass: "bg-rose-500/15",
    textClass: "text-rose-300",
  },
  bug_fixer: {
    label: "Bug Fixer",
    icon: Wrench,
    accentColor: "amber",
    borderClass: "border-amber-500/30",
    bgClass: "bg-amber-500/10",
    textClass: "text-amber-300",
  },
  general: {
    label: "General",
    icon: Bot,
    accentColor: "zinc",
    borderClass: "border-white/10",
    bgClass: "bg-zinc-800",
    textClass: "text-zinc-300",
  },
};

export function RoleAvatar({
  role,
  sessionId,
  model,
  active = false,
  size = "md",
  showLink = true,
}: RoleAvatarProps) {
  const cfg = roleConfig[role] || roleConfig.general;
  const Icon = cfg.icon;

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  const containerPadding = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border font-mono transition-all select-none ${
        containerPadding[size]
      } ${cfg.bgClass} ${cfg.borderClass} ${cfg.textClass} ${
        active ? "shadow-sm shadow-black/40" : "opacity-80"
      }`}
    >
      <div className="relative flex items-center justify-center">
        <Icon size={iconSizes[size]} className={cfg.textClass} />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </div>

      <span className="font-semibold tracking-tight">{cfg.label}</span>

      {model && (
        <span className="hidden sm:inline text-[9px] opacity-70 border-l border-current/20 pl-1.5 truncate max-w-[90px]">
          {model.split("/").pop()}
        </span>
      )}

      {showLink && sessionId && (
        <Link
          href={`/workspace/session/${encodeURIComponent(sessionId)}`}
          className="ml-1 opacity-60 hover:opacity-100 hover:text-white transition-opacity inline-flex items-center"
          title={`Open ${cfg.label} session (${sessionId})`}
        >
          <ExternalLink size={10} />
        </Link>
      )}
    </div>
  );
}
