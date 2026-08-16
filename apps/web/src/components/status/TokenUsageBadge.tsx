"use client";

import * as React from "react";
import { Cpu } from "lucide-react";

export interface TokenUsageBadgeProps {
  totalTokens?: number;
  limit?: number;
  usagePercent?: number;
  model?: string;
  isSummarized?: boolean;
  className?: string;
}

export function TokenUsageBadge({
  totalTokens = 0,
  limit = 128000,
  usagePercent = 0,
  model,
  isSummarized = false,
  className = "",
}: TokenUsageBadgeProps) {
  if (totalTokens <= 0) {
    return null;
  }

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  const percent =
    usagePercent > 0
      ? usagePercent
      : limit > 0
        ? Math.min(100, Math.round((totalTokens / limit) * 100))
        : 0;

  const isHigh = percent >= 80;
  const isMedium = percent >= 50 && percent < 80;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono select-none ${
        isHigh
          ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
          : isMedium
            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
            : "bg-zinc-800/80 border-white/10 text-zinc-400"
      } ${className}`}
      title={`Context Window: ${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens (${percent}% used)${
        model ? ` • Model: ${model}` : ""
      }${isSummarized ? " • History Summarized" : ""}`}
    >
      <Cpu
        size={11}
        className={
          isHigh
            ? "text-rose-400"
            : isMedium
              ? "text-amber-400"
              : "text-zinc-400"
        }
      />
      <span>
        {formatNumber(totalTokens)} / {formatNumber(limit)}
      </span>
      {isSummarized && (
        <span className="ml-0.5 px-1 py-0.2 bg-white/10 text-[9px] rounded font-medium text-zinc-300">
          Compact
        </span>
      )}
    </div>
  );
}
