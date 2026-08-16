"use client";

import React from "react";
import type { SpanMetric } from "@/components/metrics/LatencyChart";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";

export interface ErrorRatePanelProps {
  activeTraceCount: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  toolErrorRate: number;
  recentSpans?: SpanMetric[];
}

export function ErrorRatePanel({
  activeTraceCount,
  toolCallsTotal,
  toolCallsFailed,
  toolErrorRate,
  recentSpans = [],
}: ErrorRatePanelProps) {
  const toolStats = React.useMemo(() => {
    const map = new Map<
      string,
      { total: number; failed: number; errorRate: number }
    >();

    for (const s of recentSpans) {
      if (s.name.startsWith("tool.") || s.attributes?.toolName) {
        const name = (s.attributes?.toolName as string) || s.name;
        const current = map.get(name) || { total: 0, failed: 0, errorRate: 0 };
        current.total += 1;
        if (
          s.status === "ERROR" ||
          (s.attributes?.exitCode && s.attributes.exitCode !== 0)
        ) {
          current.failed += 1;
        }
        current.errorRate =
          Math.round((current.failed / current.total) * 10000) / 100;
        map.set(name, current);
      }
    }

    return Array.from(map.entries()).map(([name, stats]) => ({
      name,
      ...stats,
    }));
  }, [recentSpans]);

  const errorStatusColor =
    toolErrorRate === 0
      ? "text-zinc-100"
      : toolErrorRate < 5
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <Card className="border border-white/8 bg-zinc-900 shadow-xl overflow-hidden font-mono">
      <CardHeader className="border-b border-white/8 pb-3 bg-zinc-900/60">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-white tracking-wide">
              Tool Reliability & Active Concurrency
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
              Real-time trace health & execution error rates
            </CardDescription>
          </div>
          <CardAction>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800/80 px-2.5 py-1 text-xs">
              <span className="relative flex h-2 w-2">
                {activeTraceCount > 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    activeTraceCount > 0 ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
              </span>
              <span className="font-mono font-medium text-zinc-200">
                {activeTraceCount} Active Traces
              </span>
            </div>
          </CardAction>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/8 bg-zinc-800/40 p-3">
            <div className="text-[11px] font-medium text-zinc-400">
              Tool Error Rate
            </div>
            <div className={`mt-1 text-xl font-bold ${errorStatusColor}`}>
              {toolErrorRate.toFixed(1)}%
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              {toolCallsFailed} of {toolCallsTotal} failed
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-zinc-800/40 p-3">
            <div className="text-[11px] font-medium text-zinc-400">
              Total Tool Calls
            </div>
            <div className="mt-1 text-xl font-bold text-white">
              {toolCallsTotal}
            </div>
            <div className="mt-1 text-[10px] text-zinc-400">
              {toolCallsTotal - toolCallsFailed} succeeded
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-zinc-800/40 p-3">
            <div className="text-[11px] font-medium text-zinc-400">
              Trace In-Flight
            </div>
            <div className="mt-1 text-xl font-bold text-zinc-100">
              {activeTraceCount}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Concurrent spans running
            </div>
          </div>
        </div>

        {toolStats.length > 0 && (
          <div className="space-y-2 border-t border-white/8 pt-3">
            <div className="text-xs font-medium text-zinc-400">
              Failure Rates by Tool Definition
            </div>
            <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1 text-xs">
              {toolStats.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-lg border border-white/8 bg-zinc-800/30 px-2.5 py-1.5"
                >
                  <span className="font-mono text-zinc-200">{item.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-500">
                      {item.failed}/{item.total} calls
                    </span>
                    <span
                      className={`font-mono font-medium ${
                        item.errorRate === 0 ? "text-zinc-300" : "text-rose-400"
                      }`}
                    >
                      {item.errorRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
