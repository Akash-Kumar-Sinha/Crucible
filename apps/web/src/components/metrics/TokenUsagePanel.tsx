"use client";

import * as React from "react";
import { Cpu } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { captureClientError } from "@/lib/error-reporter";

export interface TokenUsageMetric {
  sessionId: string;
  model: string;
  totalTokens: number;
  limit: number;
  usagePercent: number;
  isSummarized: boolean;
  summarizedTurnCount: number;
}

export interface TokenUsagePanelProps {
  tokenMetrics?: {
    totalTokensConsumed: number;
    perSessionTokens: TokenUsageMetric[];
    summarizedSessionsCount: number;
  };
  activeSessionCount?: number;
  className?: string;
}

export function TokenUsagePanel({
  tokenMetrics,
  activeSessionCount = 0,
  className = "",
}: TokenUsagePanelProps) {
  const alertedFlatlineRef = React.useRef(false);

  const totalTokens = tokenMetrics?.totalTokensConsumed ?? 0;
  const sessionList = tokenMetrics?.perSessionTokens ?? [];
  const summarizedCount = tokenMetrics?.summarizedSessionsCount ?? 0;

  // Health Check / Observability:
  // Alert if token metrics are flatlined or missing while active sessions exist
  React.useEffect(() => {
    if (
      activeSessionCount > 0 &&
      totalTokens === 0 &&
      !alertedFlatlineRef.current
    ) {
      alertedFlatlineRef.current = true;
      captureClientError(
        `[Metrics Alert] Token usage metrics flatlined at 0 despite ${activeSessionCount} active session(s). Event emission may have failed upstream.`,
        {
          component: "TokenUsagePanel",
          action: "detect_flatlined_token_metrics",
          extra: {
            activeSessionCount,
            totalTokens,
            alert: "CRUCIBLE_METRICS_TOKEN_USAGE_FLATLINED_ALERT",
          },
        },
      );
    }
  }, [activeSessionCount, totalTokens]);

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  return (
    <Card
      className={`border-white/10 bg-zinc-900 shadow-xl overflow-hidden font-mono ${className}`}
      data-testid="token-usage-panel"
    >
      <CardHeader className="border-b border-white/8 pb-3 bg-zinc-900/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white tracking-wide">
              Context Window & Token Consumption
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Total:</span>
            <span className="text-zinc-200 font-bold">
              {formatTokens(totalTokens)} tokens
            </span>
          </div>
        </div>
        <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
          Real-time token utilization, context window boundaries, and Memento
          summarizations
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* KPI Summaries */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-white/8 bg-zinc-800/40">
            <span className="text-[10px] text-zinc-400 block mb-1">
              Active Sessions Tracked
            </span>
            <span className="text-lg font-bold text-white">
              {sessionList.length}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-zinc-800/40">
            <span className="text-[10px] text-zinc-400 block mb-1">
              Summarized / Compacted
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold text-zinc-100">
                {summarizedCount}
              </span>
              <span className="text-[10px] text-zinc-400">sessions</span>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-zinc-800/40 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-zinc-400 block mb-1">
              Avg Tokens / Session
            </span>
            <span className="text-lg font-bold text-zinc-100">
              {sessionList.length > 0
                ? formatTokens(Math.round(totalTokens / sessionList.length))
                : "0"}
            </span>
          </div>
        </div>

        {/* Per-Session Breakdown */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-zinc-300 block">
            Session Context Load
          </span>

          {sessionList.length === 0 ? (
            <div className="p-4 rounded-lg border border-white/5 bg-zinc-800/20 text-center text-xs text-zinc-400">
              No session token activity recorded yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {sessionList.map((item) => (
                <div
                  key={item.sessionId}
                  className="p-2.5 rounded-lg border border-white/5 bg-zinc-800/30 hover:border-white/10 transition-colors text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate max-w-[200px] sm:max-w-xs">
                      <span className="text-white font-medium truncate">
                        {item.sessionId}
                      </span>
                      {item.isSummarized && (
                        <span className="px-1.5 py-0.2 rounded-md bg-zinc-800 text-zinc-300 border border-white/10 text-[9px] font-bold">
                          COMPACTED
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-right shrink-0">
                      <span className="text-zinc-300">
                        {formatTokens(item.totalTokens)} /{" "}
                        {formatTokens(item.limit)}
                      </span>
                      <span
                        className={`text-[10px] font-bold ${
                          item.usagePercent >= 85
                            ? "text-rose-400"
                            : item.usagePercent >= 60
                              ? "text-amber-400"
                              : "text-zinc-300"
                        }`}
                      >
                        {item.usagePercent}%
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-zinc-800 h-1.5 rounded-lg overflow-hidden">
                    <div
                      className={`h-full rounded-lg transition-all ${
                        item.usagePercent >= 85
                          ? "bg-rose-500"
                          : item.usagePercent >= 60
                            ? "bg-amber-500"
                            : "bg-zinc-300"
                      }`}
                      style={{ width: `${Math.min(100, item.usagePercent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
