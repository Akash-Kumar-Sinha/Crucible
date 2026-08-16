"use client";

import * as React from "react";
import {
  orchestratorClient,
  type InterSessionMessage,
} from "@/api/orchestrator-client";
import { captureClientError } from "@/lib/error-reporter";
import {
  Radio,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

export interface InterSessionFeedProps {
  sessions?: Array<{ id: string; title?: string }>;
  activeSessionId?: string;
  className?: string;
  pollIntervalMs?: number;
  isOpen?: boolean;
  onClose?: () => void;
}

const typeStyles: Record<string, { bg: string; text: string; border: string }> =
  {
    delegation: {
      bg: "bg-sky-500/10",
      text: "text-sky-300",
      border: "border-sky-500/20",
    },
    result: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-300",
      border: "border-emerald-500/20",
    },
    query: {
      bg: "bg-amber-500/10",
      text: "text-amber-300",
      border: "border-amber-500/20",
    },
    event: {
      bg: "bg-purple-500/10",
      text: "text-purple-300",
      border: "border-purple-500/20",
    },
    notification: {
      bg: "bg-zinc-800",
      text: "text-zinc-300",
      border: "border-white/10",
    },
  };

export function InterSessionFeed({
  sessions = [],
  activeSessionId,
  className = "",
  pollIntervalMs = 4000,
  isOpen = true,
  onClose,
}: InterSessionFeedProps) {
  const [messages, setMessages] = React.useState<InterSessionMessage[]>([]);
  const [metrics, setMetrics] = React.useState<{
    activeSubscribers: number;
    totalPublished: number;
    totalDelivered: number;
    totalUndeliverable: number;
    deadLetterCount: number;
  }>({
    activeSubscribers: 0,
    totalPublished: 0,
    totalDelivered: 0,
    totalUndeliverable: 0,
    deadLetterCount: 0,
  });
  const [loading, setLoading] = React.useState(true);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const loggedUnresolvedRef = React.useRef<Set<string>>(new Set());

  const sessionMap = React.useMemo(() => {
    const map = new Map<string, { id: string; title?: string }>();
    for (const s of sessions) {
      map.set(s.id, s);
    }
    return map;
  }, [sessions]);

  const fetchFeed = React.useCallback(async () => {
    try {
      const data = await orchestratorClient.getInterSessionMessages(50);
      setMessages(data.messages || []);
      if (data.metrics) {
        setMetrics(data.metrics);
      }

      // Health Check / Observability Check:
      // Alert when an inter-session message references a source or target session that does not resolve
      for (const msg of data.messages || []) {
        const sourceKnown = sessionMap.has(msg.sourceSessionId);
        const targetKnown = sessionMap.has(msg.targetSessionId);

        if (!sourceKnown || !targetKnown) {
          const logKey = `${msg.id}_${msg.sourceSessionId}_${msg.targetSessionId}`;
          if (!loggedUnresolvedRef.current.has(logKey)) {
            loggedUnresolvedRef.current.add(logKey);
            captureClientError(
              `[InterSessionFeed Alert] Message references unresolved peer session(s): sourceKnown=${sourceKnown} (${msg.sourceSessionId}), targetKnown=${targetKnown} (${msg.targetSessionId})`,
              {
                component: "InterSessionFeed",
                sessionId: msg.sourceSessionId,
                action: "unresolved_peer_message",
                extra: {
                  messageId: msg.id,
                  sourceSessionId: msg.sourceSessionId,
                  targetSessionId: msg.targetSessionId,
                  alert: "CRUCIBLE_INTER_SESSION_UNRESOLVED_PEER_ALERT",
                },
              },
            );
          }
        }
      }
    } catch {
      // Handled gracefully
    } finally {
      setLoading(false);
    }
  }, [sessionMap]);

  React.useEffect(() => {
    void fetchFeed();
    const timer = setInterval(() => {
      void fetchFeed();
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [fetchFeed, pollIntervalMs]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className={`rounded-lg border border-white/10 bg-zinc-900 shadow-xl overflow-hidden font-mono flex flex-col ${className}`}
      data-testid="inter-session-feed"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-zinc-900/90 border-b border-white/8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={13} className="text-sky-400 animate-pulse" />
          <span className="text-xs font-semibold text-white tracking-wide">
            Cross-Session Bus Feed
          </span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-800 text-zinc-400">
            {messages.length} events
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[10px] text-zinc-400 hidden sm:flex items-center gap-2 font-mono">
            <span>Delivered: {metrics.totalDelivered}</span>
            {metrics.totalUndeliverable > 0 && (
              <span className="text-rose-400">
                Undelivered: {metrics.totalUndeliverable}
              </span>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Messages List */}
      <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-400">
            Connecting to session bus...
          </div>
        ) : messages.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400 space-y-1">
            <Layers
              size={18}
              className="mx-auto text-zinc-400 opacity-40 mb-1"
            />
            <p className="text-zinc-400 font-medium">
              No cross-session traffic
            </p>
            <p className="text-[10px] text-zinc-400 font-sans">
              Inter-session delegations, queries, and results will stream here
              in real-time.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSourceActive = msg.sourceSessionId === activeSessionId;
            const isTargetActive = msg.targetSessionId === activeSessionId;
            const isRelevant = isSourceActive || isTargetActive;
            const isExpanded = expandedIds.has(msg.id);

            const sourceSession = sessionMap.get(msg.sourceSessionId);
            const targetSession = sessionMap.get(msg.targetSessionId);

            const sourceTitle = sourceSession?.title || msg.sourceSessionId;
            const targetTitle = targetSession?.title || msg.targetSessionId;

            const isSourceUnresolved = !sourceSession;
            const isTargetUnresolved = !targetSession;

            const typeStyle = typeStyles[msg.type] || typeStyles.notification;

            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={msg.id}
                className={`p-2.5 rounded-lg border text-xs transition-all ${
                  isRelevant
                    ? "bg-zinc-800/80 border-sky-500/30"
                    : "bg-zinc-900/60 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                  {/* Routing: Source -> Target */}
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`truncate max-w-[110px] text-[11px] font-semibold ${
                        isSourceUnresolved
                          ? "text-rose-400 line-through"
                          : isSourceActive
                            ? "text-sky-300"
                            : "text-zinc-300"
                      }`}
                      title={msg.sourceSessionId}
                    >
                      {sourceTitle}
                    </span>

                    <ArrowRight size={11} className="text-zinc-400 shrink-0" />

                    <span
                      className={`truncate max-w-[110px] text-[11px] font-semibold ${
                        isTargetUnresolved
                          ? "text-rose-400 line-through"
                          : isTargetActive
                            ? "text-sky-300"
                            : "text-zinc-300"
                      }`}
                      title={msg.targetSessionId}
                    >
                      {targetTitle}
                    </span>

                    {(isSourceUnresolved || isTargetUnresolved) && (
                      <span className="px-1.5 py-0.2 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded text-[9px] font-bold shrink-0">
                        LEAKED/UNKNOWN PEER
                      </span>
                    )}
                  </div>

                  {/* Type Badge & Time */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-1.5 py-0.2 rounded border text-[9px] uppercase font-bold tracking-wider ${typeStyle.bg} ${typeStyle.text} ${typeStyle.border}`}
                    >
                      {msg.type}
                    </span>
                    <span className="text-[10px] text-zinc-400">{timeStr}</span>
                  </div>
                </div>

                {/* Payload Preview */}
                <button
                  type="button"
                  onClick={() => toggleExpand(msg.id)}
                  className="w-full text-left flex items-start gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 mt-1 font-mono transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown size={12} className="shrink-0 mt-0.5" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0 mt-0.5" />
                  )}
                  <span className="line-clamp-1 truncate flex-1">
                    {String(
                      msg.payload?.task ||
                        msg.payload?.action ||
                        msg.payload?.summary ||
                        msg.payload?.result ||
                        JSON.stringify(msg.payload),
                    )}
                  </span>
                </button>

                {/* Expanded Payload Inspector */}
                {isExpanded && (
                  <div className="mt-2 p-2 bg-black/60 rounded border border-white/5 text-[10px] text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-40">
                    {JSON.stringify(msg.payload, null, 2)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
