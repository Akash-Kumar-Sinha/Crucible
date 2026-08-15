"use client";

import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

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

export function LatencyChart({
  meanLatencyMs,
  p50LatencyMs: _p50LatencyMs,
  p95LatencyMs,
  p99LatencyMs,
  spans = [],
  sessionId,
}: LatencyChartProps) {
  const [hoveredSpan, setHoveredSpan] = useState<SpanMetric | null>(null);

  const validSpans = spans.filter(
    (s) => typeof s.durationMs === "number" && s.durationMs >= 0,
  );
  const displaySpans = validSpans.slice(-24);

  const maxDuration = Math.max(
    ...displaySpans.map((s) => s.durationMs || 0),
    p95LatencyMs,
    50,
  );

  const chartHeight = 140;
  const chartWidth = 520;
  const barWidth =
    displaySpans.length > 0
      ? Math.max(
          8,
          Math.min(
            22,
            Math.floor((chartWidth - 40) / Math.max(displaySpans.length, 1)) -
              4,
          ),
        )
      : 14;

  return (
    <Card className="border border-white/8">
      <CardHeader>
        <CardTitle>Latency Distribution & History</CardTitle>
        <CardDescription>
          {sessionId
            ? `Session: ${sessionId}`
            : "System-wide per-span execution latency"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="text-white/60">Mean:</span>
            <span className="font-mono font-medium text-white">
              {meanLatencyMs}ms
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-white/60">P95:</span>
            <span className="font-mono font-medium text-white">
              {p95LatencyMs}ms
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            <span className="text-white/60">P99:</span>
            <span className="font-mono font-medium text-white">
              {p99LatencyMs}ms
            </span>
          </div>
        </div>

        {displaySpans.length === 0 ? (
          <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-white/8 bg-white/5 text-xs text-white/60">
            No span execution data recorded yet
          </div>
        ) : (
          <div className="relative">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full overflow-visible"
            >
              <line
                x1="30"
                y1="10"
                x2={chartWidth}
                y2="10"
                stroke="#27272a"
                strokeDasharray="3 3"
              />
              <line
                x1="30"
                y1={chartHeight / 2}
                x2={chartWidth}
                y2={chartHeight / 2}
                stroke="#27272a"
                strokeDasharray="3 3"
              />
              <line
                x1="30"
                y1={chartHeight - 20}
                x2={chartWidth}
                y2={chartHeight - 20}
                stroke="#3f3f46"
              />

              <text
                x="24"
                y="14"
                textAnchor="end"
                className="fill-white/60 text-[10px]"
              >
                {Math.round(maxDuration)}ms
              </text>
              <text
                x="24"
                y={chartHeight / 2 + 4}
                textAnchor="end"
                className="fill-white/60 text-[10px]"
              >
                {Math.round(maxDuration / 2)}ms
              </text>
              <text
                x="24"
                y={chartHeight - 16}
                textAnchor="end"
                className="fill-white/60 text-[10px]"
              >
                0ms
              </text>

              {displaySpans.map((span, i) => {
                const dur = span.durationMs || 0;
                const heightRatio = dur / maxDuration;
                const barHeight = Math.max(4, heightRatio * (chartHeight - 35));
                const x = 36 + i * (barWidth + 4);
                const y = chartHeight - 20 - barHeight;
                const isError = span.status === "ERROR";

                return (
                  <g key={span.id || i}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx="3"
                      className={`cursor-pointer transition-all duration-150 ${
                        isError
                          ? "fill-rose-500 hover:fill-rose-400"
                          : span.name.startsWith("tool.")
                            ? "fill-primary hover:fill-primary/80"
                            : span.name.includes("model")
                              ? "fill-primary/70 hover:fill-primary"
                              : "fill-zinc-600 hover:fill-zinc-500"
                      }`}
                      onMouseEnter={() => setHoveredSpan(span)}
                      onMouseLeave={() => setHoveredSpan(null)}
                    />
                  </g>
                );
              })}
            </svg>

            {hoveredSpan && (
              <div className="absolute top-2 right-2 rounded-xl border border-white/8 bg-zinc-900/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
                <div className="font-semibold text-white">
                  {hoveredSpan.name}
                </div>
                <div className="text-white/60">
                  Duration:{" "}
                  <span className="font-mono text-primary">
                    {hoveredSpan.durationMs}ms
                  </span>{" "}
                  | Status:{" "}
                  <span
                    className={
                      hoveredSpan.status === "ERROR"
                        ? "font-medium text-rose-400"
                        : "font-medium text-primary"
                    }
                  >
                    {hoveredSpan.status}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
