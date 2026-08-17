"use client";

import * as React from "react";
import { Sparkles, Zap, Activity } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { captureClientError } from "@/lib/error-reporter";

export interface ModelUsageMetric {
  model: string;
  requestCount: number;
  totalLatencyMs: number;
  meanLatencyMs: number;
  errorCount: number;
  errorRate: number;
}

export interface ModelUsagePanelProps {
  modelMetrics?: {
    totalRequests: number;
    models: Record<string, ModelUsageMetric>;
  };
  totalSpansRecorded?: number;
  className?: string;
}

export function ModelUsagePanel({
  modelMetrics,
  totalSpansRecorded = 0,
  className = "",
}: ModelUsagePanelProps) {
  const alertedFlatlineRef = React.useRef(false);

  const models = modelMetrics?.models ?? {};
  const totalRequests = modelMetrics?.totalRequests ?? 0;
  const modelList = Object.values(models);

  // Health Check / Observability:
  // Alert if total model requests flatlines at 0 while spans have been recorded
  React.useEffect(() => {
    if (
      totalSpansRecorded > 10 &&
      totalRequests === 0 &&
      !alertedFlatlineRef.current
    ) {
      alertedFlatlineRef.current = true;
      captureClientError(
        `[Metrics Alert] Model request volume flatlined at 0 despite ${totalSpansRecorded} recorded spans. Model tag propagation may have broken upstream.`,
        {
          component: "ModelUsagePanel",
          action: "detect_flatlined_model_metrics",
          extra: {
            totalSpansRecorded,
            totalRequests,
            alert: "CRUCIBLE_METRICS_MODEL_USAGE_FLATLINED_ALERT",
          },
        },
      );
    }
  }, [totalSpansRecorded, totalRequests]);

  return (
    <Card
      className={`border-white/10 bg-zinc-900 shadow-xl overflow-hidden font-mono ${className}`}
      data-testid="model-usage-panel"
    >
      <CardHeader className="border-b border-white/8 pb-3 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-zinc-400" />
          <CardTitle className="text-sm font-semibold text-white tracking-wide">
            Model Strategy Distribution
          </CardTitle>
        </div>
        <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
          Per-model request volume, latency profiles, and failure rates across
          OpenRouter gateway
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Total Calls:</span>
            <span className="text-zinc-200 font-bold">{totalRequests}</span>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {modelList.length === 0 ? (
          <div className="p-6 rounded-lg border border-white/5 bg-zinc-800/20 text-center text-xs text-zinc-400">
            No model request traffic recorded yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {modelList.map((m) => {
              const shortName = m.model.split("/").pop() || m.model;
              const provider = m.model.split("/")[0] || "openrouter";
              const share =
                totalRequests > 0
                  ? Math.round((m.requestCount / totalRequests) * 100)
                  : 0;

              return (
                <div
                  key={m.model}
                  className="p-3 rounded-lg border border-white/8 bg-zinc-800/40 hover:border-white/15 transition-all text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="font-semibold text-white truncate max-w-[170px]"
                        title={m.model}
                      >
                        {shortName}
                      </span>
                      <span className="px-1.5 py-0.2 rounded-md bg-zinc-800 text-[9px] text-zinc-400 border border-white/5 uppercase shrink-0">
                        {provider}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-zinc-200 shrink-0">
                      {m.requestCount} reqs
                    </span>
                  </div>

                  {/* Share Bar */}
                  <div className="w-full bg-zinc-800 h-1 rounded-lg overflow-hidden">
                    <div
                      className="bg-zinc-300 h-full rounded-lg transition-all"
                      style={{ width: `${Math.max(4, share)}%` }}
                    />
                  </div>

                  {/* Performance Indicators */}
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
                    <div className="flex items-center gap-1">
                      <Zap size={11} className="text-zinc-500" />
                      <span>
                        {m.meanLatencyMs > 0 ? `${m.meanLatencyMs}ms avg` : "—"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Activity size={11} className="text-zinc-500" />
                      <span
                        className={
                          m.errorRate > 5
                            ? "text-rose-400 font-bold"
                            : "text-zinc-400"
                        }
                      >
                        {m.errorRate}% err
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
