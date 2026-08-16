"use client";

import * as React from "react";
import { Eye, MessageSquare, Columns, AlertTriangle } from "lucide-react";

export type PreviewLayoutMode = "chat" | "split" | "preview";

export interface PreviewToggleProps {
  mode: PreviewLayoutMode;
  onChange: (mode: PreviewLayoutMode) => void;
  active: boolean;
  status?: "idle" | "starting" | "ready" | "crashed" | "stopped";
  onRestart?: () => void;
  disabled?: boolean;
}

export function PreviewToggle({
  mode,
  onChange,
  active,
  status = "idle",
  onRestart,
  disabled = false,
}: PreviewToggleProps) {
  const isCrashed = status === "crashed";
  const isReady = active && status === "ready";

  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-white/8 rounded-lg p-1 font-mono text-xs select-none">
      {/* Mode Switches */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("chat")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          mode === "chat"
            ? "bg-zinc-800 text-white font-medium shadow-sm border border-white/10"
            : "text-zinc-400 hover:text-zinc-200"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Chat Only"
      >
        <MessageSquare size={13} />
        <span className="hidden sm:inline">Chat</span>
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("split")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          mode === "split"
            ? "bg-zinc-800 text-white font-medium shadow-sm border border-white/10"
            : "text-zinc-400 hover:text-zinc-200"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Split View: Chat + Live Sandbox Preview"
      >
        <Columns size={13} />
        <span className="hidden sm:inline">Split</span>
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("preview")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          mode === "preview"
            ? "bg-zinc-800 text-white font-medium shadow-sm border border-white/10"
            : "text-zinc-400 hover:text-zinc-200"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Preview Only"
      >
        <Eye size={13} />
        <span className="hidden sm:inline">Preview</span>
      </button>

      {/* Live / Status Indicator */}
      <div className="ml-1 pl-2 border-l border-white/10 flex items-center gap-1.5">
        {isReady && (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Preview
          </span>
        )}

        {isCrashed && (
          <button
            type="button"
            onClick={onRestart}
            className="flex items-center gap-1 text-[10px] text-rose-400 px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 font-bold"
            title="Preview server crashed. Click to restart."
          >
            <AlertTriangle size={10} />
            <span>Crashed - Restart</span>
          </button>
        )}

        {!isReady && !isCrashed && (
          <span className="text-[10px] text-zinc-500 px-1.5 py-0.5">
            {status === "starting" ? "Booting..." : "Offline"}
          </span>
        )}
      </div>
    </div>
  );
}
