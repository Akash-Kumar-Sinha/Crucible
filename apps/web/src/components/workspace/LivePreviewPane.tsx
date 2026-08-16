"use client";

import * as React from "react";
import type { PreviewInfo, AgentMessage } from "@/api/orchestrator-client";
import { orchestratorClient } from "@/api/orchestrator-client";
import { synthesizeLivePreviewFromMessages } from "@/lib/preview-synthesizer";
import {
  RefreshCw,
  ExternalLink,
  Smartphone,
  Tablet,
  Monitor,
  AlertTriangle,
  Lock,
  Play,
  XCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type ViewportMode = "desktop" | "tablet" | "mobile";

export interface LivePreviewPaneProps {
  sessionId: string;
  previewUrl: string;
  previewInfo?: PreviewInfo | null;
  messages?: AgentMessage[];
  onRestart?: () => void;
  onClose?: () => void;
  isLoading?: boolean;
}

export function LivePreviewPane({
  sessionId,
  previewUrl,
  previewInfo,
  messages = [],
  onRestart,
  onClose,
  isLoading = false,
}: LivePreviewPaneProps) {
  const [viewport, setViewport] = React.useState<ViewportMode>("desktop");
  const [iframeKey, setIframeKey] = React.useState(1);
  const [isIframeLoading, setIsIframeLoading] = React.useState(false);
  const [iframeError, setIframeError] = React.useState(false);

  const isCrashed = previewInfo?.status === "crashed";
  const isReady = previewInfo?.status === "ready";

  const synthesizedDoc = React.useMemo(() => {
    return synthesizeLivePreviewFromMessages(messages, sessionId);
  }, [messages, sessionId]);

  // Sync synthesized frontend with orchestrator for external tab opening
  React.useEffect(() => {
    if (synthesizedDoc && sessionId) {
      orchestratorClient
        .startPreview(sessionId, { staticHtml: synthesizedDoc })
        .catch(() => {});
    }
  }, [synthesizedDoc, sessionId]);

  const handleRefresh = () => {
    setIsIframeLoading(true);
    setIframeError(false);
    setIframeKey((k) => k + 1);
  };

  const getViewportWidth = () => {
    switch (viewport) {
      case "mobile":
        return "max-w-[375px]";
      case "tablet":
        return "max-w-[768px]";
      case "desktop":
      default:
        return "w-full";
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-white/8 font-mono select-none overflow-hidden">
      {/* Top Controls Bar */}
      <div className="h-12 border-b border-white/8 bg-zinc-950/90 px-3 flex items-center justify-between gap-2 shrink-0">
        {/* Left: Path / Address Pill */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/50 border border-white/10 text-xs text-zinc-300 min-w-0 max-w-sm truncate">
            <Lock
              size={11}
              className={
                isReady || synthesizedDoc
                  ? "text-emerald-400 shrink-0"
                  : "text-zinc-500 shrink-0"
              }
            />
            <span className="truncate">{previewUrl}</span>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            title="Reload Preview"
          >
            <RefreshCw
              size={13}
              className={
                isLoading || isIframeLoading ? "animate-spin text-sky-400" : ""
              }
            />
          </button>

          {synthesizedDoc && (
            <span className="hidden lg:flex items-center gap-1 text-[10px] text-sky-400 bg-sky-950/50 border border-sky-500/30 px-2 py-0.5 rounded-full font-medium">
              <Sparkles size={10} />
              Live Interactive
            </span>
          )}

          {iframeError && (
            <span className="text-[10px] text-rose-400 font-medium">
              Load failed
            </span>
          )}
        </div>

        {/* Center: Device Viewport Switches */}
        <div className="hidden sm:flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/8">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            className={`p-1 rounded transition-colors ${
              viewport === "desktop"
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="Desktop View (100%)"
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            onClick={() => setViewport("tablet")}
            className={`p-1 rounded transition-colors ${
              viewport === "tablet"
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="Tablet View (768px)"
          >
            <Tablet size={14} />
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            className={`p-1 rounded transition-colors ${
              viewport === "mobile"
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="Mobile View (375px)"
          >
            <Smartphone size={14} />
          </button>
        </div>

        {/* Right: Popout & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            title="Open In New Window"
          >
            <ExternalLink size={13} />
          </a>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors text-xs"
              title="Close Preview Pane"
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Crash or Failure Banner */}
      {isCrashed && (
        <div className="bg-rose-950/60 border-b border-rose-500/30 p-2.5 px-4 flex items-center justify-between gap-3 text-xs text-rose-300 animate-pulse shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-rose-400 shrink-0" />
            <span>
              Preview server crashed inside sandbox:{" "}
              {previewInfo?.error || "Connection terminated"}
            </span>
          </div>
          {onRestart && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRestart}
              className="h-7 text-xs bg-rose-500/20 border-rose-500/40 hover:bg-rose-500/30 text-rose-200"
            >
              <Play size={11} className="mr-1" />
              Restart Dev Server
            </Button>
          )}
        </div>
      )}

      {/* Preview Frame Stage */}
      <div className="flex-1 bg-zinc-950/80 flex items-center justify-center p-2 sm:p-4 overflow-hidden relative">
        <div
          className={`h-full ${getViewportWidth()} mx-auto transition-all duration-300 rounded-lg overflow-hidden border border-white/10 bg-white shadow-2xl relative flex flex-col`}
        >
          {/* Strict MDN & OWASP Hardened Sandbox Iframe */}
          <iframe
            key={`${iframeKey}-${synthesizedDoc ? "synth" : "proxy"}`}
            {...(synthesizedDoc
              ? { srcDoc: synthesizedDoc }
              : { src: previewUrl })}
            title={`Crucible Sandbox Preview - Session ${sessionId}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full h-full border-0 bg-white"
            onLoad={() => setIsIframeLoading(false)}
            onError={() => {
              setIsIframeLoading(false);
              setIframeError(true);
            }}
          />
        </div>
      </div>

      {/* Footer Security Badge */}
      <div className="h-8 border-t border-white/8 bg-zinc-950 px-3 flex items-center justify-between text-[10px] text-zinc-500 shrink-0">
        <div className="flex items-center gap-1.5">
          <Lock size={10} className="text-emerald-400" />
          <span>
            Hardened Iframe Sandbox • Air-Gapped Egress • Port 5173 Reverse
            Proxy
          </span>
        </div>
        <div>
          <span>Viewport: {viewport.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}
