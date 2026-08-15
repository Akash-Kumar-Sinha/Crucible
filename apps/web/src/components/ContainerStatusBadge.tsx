"use client";

import * as React from "react";
import { Container, AlertTriangle, CheckCircle, Flame } from "lucide-react";
import { SandboxInfoPanel } from "./SandboxInfoPanel";

export interface ContainerStatusBadgeProps {
  exitCode?: number | null;
  oomKilled?: boolean;
  containerId?: string;
  image?: string;
  restarts?: number;
  sessionId?: string;
  className?: string;
}

export function ContainerStatusBadge({
  exitCode,
  oomKilled = false,
  containerId,
  image,
  restarts = 0,
  sessionId,
  className = "",
}: ContainerStatusBadgeProps) {
  const [isPanelOpen, setIsPanelOpen] = React.useState(false);

  // If no execution metadata is present, do not render
  if (exitCode === undefined && !oomKilled && !containerId) {
    return null;
  }

  const isSuccess = exitCode === 0 && !oomKilled;
  const isOOM = oomKilled || exitCode === 137;
  const isTerminated = exitCode === 143;

  const badgeColor = isOOM
    ? "bg-rose-950/50 border-rose-500/40 text-rose-300"
    : isSuccess
      ? "bg-zinc-900 border-white/10 text-zinc-300 hover:border-white/20"
      : "bg-amber-950/40 border-amber-500/30 text-amber-300";

  const statusLabel = isOOM
    ? "OOMKilled (137)"
    : isTerminated
      ? "SIGTERM (143)"
      : exitCode !== undefined && exitCode !== null
        ? `Exit ${exitCode}`
        : "Container Executed";

  return (
    <>
      <button
        type="button"
        onClick={() => setIsPanelOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono transition-colors ${badgeColor} ${className}`}
        title={`Container ${containerId || "sandbox"}: ${statusLabel}. Click to view sandbox profile.`}
      >
        {isOOM ? (
          <Flame size={11} className="text-rose-400 shrink-0" />
        ) : isSuccess ? (
          <CheckCircle size={11} className="text-neutral-400 shrink-0" />
        ) : (
          <AlertTriangle size={11} className="text-amber-400 shrink-0" />
        )}
        <Container size={11} className="opacity-60 shrink-0" />
        <span className="font-medium">{statusLabel}</span>
        {containerId && (
          <span className="opacity-50 font-normal">
            #{containerId.slice(0, 7)}
          </span>
        )}
        {restarts > 0 && (
          <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] text-zinc-200">
            {restarts}x restart
          </span>
        )}
      </button>

      {/* Sandbox Isolation Profile Dialog */}
      <SandboxInfoPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        sessionId={sessionId}
      />
    </>
  );
}
