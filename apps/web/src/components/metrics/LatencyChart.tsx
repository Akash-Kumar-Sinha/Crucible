"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface SpanMetric {
  id: string;
  name: string;
  durationMs?: number;
  status: "OK" | "ERROR" | "UNSET";
  startTime: number;
  attributes?: Record<string, unknown>;
}

export interface LatencyChartProps {
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  spans: SpanMetric[];
  sessionId?: string;
}

const chartConfig = {
  durationMs: {
    label: "Latency (ms)",
    color: "#e4e4e7",
  },
  mean: {
    label: "Mean Latency",
    color: "#a1a1aa",
  },
  p95: {
    label: "P95 Threshold",
    color: "#f59e0b",
  },
  p99: {
    label: "P99 Critical",
    color: "#f43f5e",
  },
} satisfies ChartConfig;

export function LatencyChart({
  meanLatencyMs,
  p50LatencyMs: _p50LatencyMs,
  p95LatencyMs,
  p99LatencyMs,
  spans = [],
  sessionId,
}: LatencyChartProps) {
  const chartData = useMemo(() => {
    const validSpans = spans.filter(
      (s) => typeof s.durationMs === "number" && s.durationMs >= 0,
    );
    const displaySpans = validSpans.slice(-20);
    return displaySpans.map((s, idx) => ({
      index: idx + 1,
      name: s.name,
      shortName: s.name
        .replace(/^tool\./, "")
        .replace(/^model\./, "")
        .substring(0, 10),
      durationMs: s.durationMs || 0,
      status: s.status,
      id: s.id,
    }));
  }, [spans]);

  return (
    <Card className="border border-white/10 bg-zinc-900/80 shadow-xl overflow-hidden font-mono">
      <CardHeader className="border-b border-white/8 pb-3 bg-zinc-900/60">
        <CardTitle className="text-sm font-semibold text-white tracking-wide">
          Latency Distribution & History
        </CardTitle>
        <CardDescription className="text-xs text-zinc-400 font-sans mt-0.5">
          {sessionId
            ? `Session scope: ${sessionId}`
            : "System-wide per-span execution latency & tails"}
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
            <span className="text-zinc-400">Mean:</span>
            <span className="font-mono font-medium text-white">
              {meanLatencyMs}ms
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-zinc-400">P95:</span>
            <span className="font-mono font-medium text-white">
              {p95LatencyMs}ms
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            <span className="text-zinc-400">P99:</span>
            <span className="font-mono font-medium text-white">
              {p99LatencyMs}ms
            </span>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-white/8 bg-zinc-800/20 text-xs text-zinc-500 font-sans">
            No span execution data recorded yet
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-44 w-full aspect-auto"
          >
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(255,255,255,0.06)"
              />
              <XAxis
                dataKey="shortName"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: "#71717a", fontSize: 10 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={(val) => `${val}ms`}
              />
              {p95LatencyMs > 0 && (
                <ReferenceLine
                  y={p95LatencyMs}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                />
              )}
              {meanLatencyMs > 0 && (
                <ReferenceLine
                  y={meanLatencyMs}
                  stroke="#a1a1aa"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
              )}
              <ChartTooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => (
                      <div className="flex items-center justify-between gap-3 min-w-32">
                        <span className="text-zinc-400 text-xs font-mono">
                          {item?.payload?.name}
                        </span>
                        <span className="font-mono font-bold text-white text-xs">
                          {value}ms
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="durationMs" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.status === "ERROR"
                        ? "#f43f5e"
                        : entry.name.startsWith("tool.")
                          ? "#e4e4e7"
                          : "#71717a"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
