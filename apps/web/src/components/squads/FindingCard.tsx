"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Bug,
} from "lucide-react";

export interface Finding {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "being_fixed" | "resolved";
  discoveredBy?: "bug_hunter" | "test_writer" | string;
  details?: string;
  timestamp: number;
  fixedInIteration?: number;
}

export interface FindingCardProps {
  finding: Finding;
  onSelect?: (finding: Finding) => void;
}

const severityConfig: Record<
  Finding["severity"],
  { label: string; bg: string; text: string; border: string }
> = {
  critical: {
    label: "Critical",
    bg: "bg-rose-500/20",
    text: "text-rose-300",
    border: "border-rose-500/40",
  },
  high: {
    label: "High",
    bg: "bg-orange-500/20",
    text: "text-orange-300",
    border: "border-orange-500/30",
  },
  medium: {
    label: "Medium",
    bg: "bg-amber-500/20",
    text: "text-amber-300",
    border: "border-amber-500/30",
  },
  low: {
    label: "Low",
    bg: "bg-sky-500/20",
    text: "text-sky-300",
    border: "border-sky-500/30",
  },
};

const statusConfig: Record<
  Finding["status"],
  {
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    bg: string;
    text: string;
  }
> = {
  open: {
    label: "Open Finding",
    icon: AlertTriangle,
    bg: "bg-rose-500/10 border-rose-500/30",
    text: "text-rose-400",
  },
  being_fixed: {
    label: "Fix in Progress",
    icon: Bug,
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-400",
  },
  resolved: {
    label: "Resolved & Verified",
    icon: CheckCircle2,
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-400",
  },
};

export function FindingCard({ finding, onSelect }: FindingCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const sev = severityConfig[finding.severity] || severityConfig.medium;
  const stat = statusConfig[finding.status] || statusConfig.open;
  const StatusIcon = stat.icon;

  const formattedTime = new Date(finding.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      onClick={() => onSelect?.(finding)}
      className="group rounded-lg border border-white/8 bg-zinc-900/80 hover:bg-zinc-800/80 hover:border-white/15 p-3.5 transition-all shadow-sm space-y-2.5 font-mono"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${sev.bg} ${sev.text} ${sev.border}`}
          >
            {sev.label}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${stat.bg} ${stat.text}`}
          >
            <StatusIcon size={10} />
            <span>{stat.label}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0">
          <Clock size={10} />
          <span>{formattedTime}</span>
        </div>
      </div>

      <div className="text-xs font-medium text-zinc-200 group-hover:text-white leading-snug">
        {finding.title}
      </div>

      {finding.details && (
        <div className="space-y-1">
          <p
            className={`text-[11px] text-zinc-400 leading-relaxed font-mono bg-black/40 p-2 rounded-lg border border-white/5 whitespace-pre-wrap ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {finding.details}
          </p>
          {finding.details.length > 90 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold"
            >
              {expanded ? "Show less" : "Show full trace..."}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-zinc-500">
        <div className="flex items-center gap-1">
          <ShieldAlert size={10} className="text-rose-400" />
          <span>By: {finding.discoveredBy || "Bug Hunter"}</span>
        </div>
        {finding.fixedInIteration !== undefined && (
          <span className="text-emerald-400/80">
            Fix Iteration #{finding.fixedInIteration}
          </span>
        )}
      </div>
    </div>
  );
}
