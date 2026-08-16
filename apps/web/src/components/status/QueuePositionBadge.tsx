"use client";

import * as React from "react";
import { Clock, Layers } from "lucide-react";

export interface QueuePositionBadgeProps {
  position?: number;
  backlogCount?: number;
  activeConsumers?: number;
  estimatedWaitMs?: number;
  status?: "idle" | "queued" | "processing" | "completed" | "dead_letter";
  className?: string;
}

export function QueuePositionBadge({
  position = -1,
  backlogCount = 0,
  activeConsumers = 2,
  estimatedWaitMs = 0,
  status = "queued",
  className = "",
}: QueuePositionBadgeProps) {
  if (status !== "queued" && position <= 0) {
    return null;
  }

  const isNextInLine = position === 1;
  const aheadCount = Math.max(0, position - 1);
  const waitSeconds = Math.max(1, Math.round(estimatedWaitMs / 1000));

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-950/30 px-2.5 py-1 text-[10px] font-mono text-sky-200 backdrop-blur-md shadow-sm ${className}`}
      title={`Position in load-leveling queue: ${position} (${aheadCount} ahead) | Estimated wait: ~${waitSeconds}s | Workers: ${activeConsumers}`}
    >
      <div className="flex items-center gap-1.5">
        <Clock size={11} className="animate-spin text-sky-400 shrink-0" />
        <span className="font-semibold text-sky-300">
          {isNextInLine ? "Queue #1 (Next)" : `Queue #${position}`}
        </span>
      </div>

      {aheadCount > 0 && (
        <span className="text-sky-300/80 border-l border-sky-500/20 pl-2">
          {aheadCount} ahead
        </span>
      )}

      {estimatedWaitMs > 0 && (
        <span className="text-sky-400 font-medium border-l border-sky-500/20 pl-2">
          ~{waitSeconds}s wait
        </span>
      )}

      {backlogCount > 0 && (
        <div className="hidden sm:flex items-center gap-1 text-sky-400/70 border-l border-sky-500/20 pl-2">
          <Layers size={10} />
          <span>{backlogCount} pending</span>
        </div>
      )}
    </div>
  );
}
