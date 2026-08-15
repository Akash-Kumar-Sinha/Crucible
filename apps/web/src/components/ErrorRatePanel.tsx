"use client";

import React from "react";
import type { SpanMetric } from "./LatencyChart";
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
      ? "text-primary"
      : toolErrorRate < 5
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <Card className="border border-white/8">
      <CardHeader>
        <CardTitle>Tool Reliability & Active Concurrency</CardTitle>
        <CardDescription>
          Real-time trace health & execution error rates
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs">
            <span className="relative flex h-2 w-2">
              {activeTraceCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              )}
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="font-mono font-medium text-primary">
              {activeTraceCount} Active Traces
            </span>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/8 bg-white/5 p-3">
            <div className="text-[11px] font-medium text-white/60">
              Tool Error Rate
            </div>
            <div className={`mt-1 text-xl font-bold ${errorStatusColor}`}>
              {toolErrorRate.toFixed(1)}%
            </div>
            <div className="mt-1 text-[10px] text-white/60">
              {toolCallsFailed} of {toolCallsTotal} failed
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/5 p-3">
            <div className="text-[11px] font-medium text-white/60">
              Total Tool Calls
            </div>
            <div className="mt-1 text-xl font-bold text-white">
              {toolCallsTotal}
            </div>
            <div className="mt-1 text-[10px] text-primary/90">
              {toolCallsTotal - toolCallsFailed} succeeded
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/5 p-3">
            <div className="text-[11px] font-medium text-white/60">
              Trace In-Flight
            </div>
            <div className="mt-1 text-xl font-bold text-primary">
              {activeTraceCount}
            </div>
            <div className="mt-1 text-[10px] text-white/60">
              Concurrent spans running
            </div>
          </div>
        </div>

        {toolStats.length > 0 && (
          <div className="space-y-2 border-t border-white/8 pt-2">
            <div className="text-xs font-medium text-white/60">
              Failure Rates by Tool Definition
            </div>
            <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1 text-xs">
              {toolStats.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-xl border border-white/8 bg-white/5 px-2.5 py-1.5"
                >
                  <span className="font-mono text-white/80">{item.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-white/60">
                      {item.failed}/{item.total} calls
                    </span>
                    <span
                      className={`font-mono font-medium ${
                        item.errorRate === 0 ? "text-primary" : "text-rose-400"
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
