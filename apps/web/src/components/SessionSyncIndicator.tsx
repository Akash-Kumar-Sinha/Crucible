"use client";

import * as React from "react";
import { Check, CloudOff, RefreshCw } from "lucide-react";
import { useSessionStore } from "../stores/session-store";

export interface SessionSyncIndicatorProps {
  className?: string;
}

export function SessionSyncIndicator({
  className = "",
}: SessionSyncIndicatorProps) {
  const isStreamConnected = useSessionStore((s) => s.isStreamConnected);
  const status = useSessionStore((s) => s.status);
  const isSending = useSessionStore((s) => s.isSending);
  const currentSession = useSessionStore((s) => s.currentSession);
  const error = useSessionStore((s) => s.error);

  if (!currentSession) {
    return null;
  }

  // 1. Reconnecting state (Active session but stream connection dropped)
  if (!isStreamConnected && status === "running") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-[11px] font-mono text-amber-300 animate-pulse ${className}`}
        title="Orchestrator connection lost. Attempting graceful session reconnect…"
      >
        <RefreshCw size={10} className="animate-spin text-amber-400" />
        <span>Reconnecting session…</span>
      </div>
    );
  }

  // 2. Saving / Syncing state
  if (isSending || status === "running") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-mono text-zinc-300 ${className}`}
        title="Processing turn and synchronizing state to PostgreSQL & Redis…"
      >
        <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-ping" />
        <span>Syncing…</span>
      </div>
    );
  }

  // 3. Offline / Error state
  if (error && !isStreamConnected) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-950/20 px-2 py-0.5 text-[11px] font-mono text-rose-300 ${className}`}
        title="Session disconnected from persistence layer"
      >
        <CloudOff size={11} className="text-rose-400" />
        <span>Offline</span>
      </div>
    );
  }

  // 4. Saved / Idle state (Durable persistence verified)
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-white/5 bg-zinc-900/60 px-2 py-0.5 text-[10px] font-mono text-zinc-400 ${className}`}
      title="Session state and run history saved to durable database"
    >
      <Check size={10} className="text-neutral-400" />
      <span>Saved</span>
    </div>
  );
}
