"use client";

import * as React from "react";
import { Code, ShieldCheck, Bug, Wrench, Bot } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { captureClientError } from "@/lib/error-reporter";

export interface RoleActivityMetric {
  role: string;
  sessionCount: number;
  turnCount: number;
  toolCallsCount: number;
  errorCount: number;
  errorRate: number;
  crossSessionSent: number;
  crossSessionReceived: number;
}

export interface CrossSessionMetrics {
  totalPublished: number;
  totalDelivered: number;
  totalUndeliverable: number;
  deadLetterCount: number;
  activeSubscribers: number;
}

export interface RoleActivityPanelProps {
  roleMetrics?: {
    roles: Record<string, RoleActivityMetric>;
  };
  crossSessionMetrics?: CrossSessionMetrics;
  totalSpansRecorded?: number;
  className?: string;
}

const roleMeta: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; badge: string }
> = {
  coder: {
    label: "Coder",
    icon: <Code size={14} className="text-zinc-300" />,
    color: "border-white/10 bg-zinc-800/40",
    badge: "text-zinc-200 bg-zinc-800 border-white/10",
  },
  test_writer: {
    label: "Test Writer",
    icon: <ShieldCheck size={14} className="text-emerald-400" />,
    color: "border-emerald-500/20 bg-emerald-950/20",
    badge: "text-emerald-300 bg-emerald-950/40 border-emerald-500/30",
  },
  bug_hunter: {
    label: "Bug Hunter",
    icon: <Bug size={14} className="text-rose-400" />,
    color: "border-rose-500/20 bg-rose-950/20",
    badge: "text-rose-300 bg-rose-950/40 border-rose-500/30",
  },
  bug_fixer: {
    label: "Bug Fixer",
    icon: <Wrench size={14} className="text-amber-400" />,
    color: "border-amber-500/20 bg-amber-950/20",
    badge: "text-amber-300 bg-amber-950/40 border-amber-500/30",
  },
  general: {
    label: "General",
    icon: <Bot size={14} className="text-zinc-400" />,
    color: "border-white/10 bg-zinc-800/40",
    badge: "text-zinc-300 bg-zinc-800 border-white/10",
  },
};

export function RoleActivityPanel({
  roleMetrics,
  crossSessionMetrics,
  totalSpansRecorded = 0,
  className = "",
}: RoleActivityPanelProps) {
  const alertedFlatlineRef = React.useRef(false);

  const roles = roleMetrics?.roles ?? {};
  const roleList = Object.values(roles);

  const totalCrossPublished = crossSessionMetrics?.totalPublished ?? 0;
  const totalCrossDelivered = crossSessionMetrics?.totalDelivered ?? 0;
  const totalCrossUndelivered = crossSessionMetrics?.totalUndeliverable ?? 0;
  const totalDeadLetters = crossSessionMetrics?.deadLetterCount ?? 0;

  // Health Check / Observability:
  // Alert if role activity metrics flatline while spans exist
  React.useEffect(() => {
    const totalTurns = roleList.reduce((acc, r) => acc + r.turnCount, 0);
    if (
      totalSpansRecorded > 15 &&
      totalTurns === 0 &&
      !alertedFlatlineRef.current
    ) {
      alertedFlatlineRef.current = true;
      captureClientError(
        `[Metrics Alert] Role activity metrics flatlined at 0 turns despite ${totalSpansRecorded} recorded spans. Role tag tracking may have failed upstream.`,
        {
          component: "RoleActivityPanel",
          action: "detect_flatlined_role_metrics",
          extra: {
            totalSpansRecorded,
            totalTurns,
            alert: "CRUCIBLE_METRICS_ROLE_ACTIVITY_FLATLINED_ALERT",
          },
        },
      );
    }
  }, [totalSpansRecorded, roleList]);

  return (
    <Card
      className={`border-white/10 bg-zinc-900 shadow-xl overflow-hidden font-mono ${className}`}
      data-testid="role-activity-panel"
    >
      <CardHeader className="border-b border-white/8 pb-3 bg-zinc-900/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white tracking-wide">
              Agent Roles & Cross-Session Traffic
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Cross-Bus:</span>
            <span className="text-zinc-200 font-bold">
              {totalCrossPublished} msgs
            </span>
          </div>
        </div>
        <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
          Workload distribution by agent specialization, fault probing rates,
          and inter-session bus routing
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Cross-Session Bus KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-2.5 rounded-lg border border-white/8 bg-zinc-800/30">
            <span className="text-[10px] text-zinc-400 block mb-0.5">
              Bus Published
            </span>
            <span className="text-base font-bold text-white">
              {totalCrossPublished}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-white/8 bg-zinc-800/30">
            <span className="text-[10px] text-zinc-400 block mb-0.5">
              Delivered
            </span>
            <span className="text-base font-bold text-emerald-300">
              {totalCrossDelivered}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-white/8 bg-zinc-800/30">
            <span className="text-[10px] text-zinc-400 block mb-0.5">
              Undeliverable
            </span>
            <span
              className={`text-base font-bold ${
                totalCrossUndelivered > 0 ? "text-rose-400" : "text-zinc-400"
              }`}
            >
              {totalCrossUndelivered}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-white/8 bg-zinc-800/30">
            <span className="text-[10px] text-zinc-400 block mb-0.5">
              Dead Letters
            </span>
            <span
              className={`text-base font-bold ${
                totalDeadLetters > 0 ? "text-amber-400" : "text-zinc-400"
              }`}
            >
              {totalDeadLetters}
            </span>
          </div>
        </div>

        {/* Roles Breakdown Grid */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-zinc-300 block">
            Role Activity & Fault Profiles
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {roleList.map((r) => {
              const meta = roleMeta[r.role] || roleMeta.general;
              const isBugHunter = r.role === "bug_hunter";

              return (
                <div
                  key={r.role}
                  className={`p-3 rounded-lg border text-xs space-y-2 transition-all ${meta.color}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {meta.icon}
                      <span className="font-semibold text-white">
                        {meta.label}
                      </span>
                    </div>
                    <span
                      className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${meta.badge}`}
                    >
                      {r.sessionCount} sessions
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[10px] text-zinc-400 pt-1 border-t border-white/5">
                    <div>
                      <span className="block text-zinc-500">Turns</span>
                      <span className="text-white font-medium">
                        {r.turnCount}
                      </span>
                    </div>
                    <div>
                      <span className="block text-zinc-500">Tools</span>
                      <span className="text-white font-medium">
                        {r.toolCallsCount}
                      </span>
                    </div>
                    <div>
                      <span className="block text-zinc-500">Error Rate</span>
                      <span
                        className={`font-medium ${
                          isBugHunter
                            ? "text-zinc-300" // Probing errors expected
                            : r.errorRate > 5
                              ? "text-rose-400 font-bold"
                              : "text-zinc-300"
                        }`}
                        title={
                          isBugHunter
                            ? "Probing errors from red-team auditing are expected"
                            : undefined
                        }
                      >
                        {r.errorRate}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
