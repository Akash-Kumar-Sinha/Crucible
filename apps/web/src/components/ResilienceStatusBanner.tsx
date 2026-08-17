"use client";

import * as React from "react";
import Link from "next/link";
import { orchestratorClient } from "../api/orchestrator-client";
import { captureClientError } from "../lib/error-reporter";

export interface ResilienceStatusBannerProps {
  children?: React.ReactNode;
  className?: string;
  pollIntervalMs?: number;
  initialBreakerState?: {
    name: string;
    state: "open" | "half_open" | "closed";
    failureCount?: number;
  };
  initialRateLimited?: boolean;
}

export function ResilienceStatusBanner({
  children,
  className = "",
  pollIntervalMs = 5000,
  initialBreakerState,
  initialRateLimited = false,
}: ResilienceStatusBannerProps) {
  const [openBreakers, setOpenBreakers] = React.useState<
    Array<{
      name: string;
      state: "open" | "half_open" | "closed";
      failureCount?: number;
      lastError?: string;
    }>
  >(
    initialBreakerState && initialBreakerState.state !== "closed"
      ? [initialBreakerState]
      : [],
  );
  const [isRateLimited, setIsRateLimited] = React.useState(initialRateLimited);
  const [resetting, setResetting] = React.useState<string | null>(null);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await orchestratorClient.getResilienceStatus();
      if (res && res.breakers) {
        const active = res.breakers.filter(
          (b) => b.state === "open" || b.state === "half_open",
        );
        setOpenBreakers(active);

        if (active.length > 0) {
          captureClientError(
            `Resilience Alert: Circuit breakers active [${active.map((b) => `${b.name}:${b.state}`).join(", ")}]`,
            {
              component: "ResilienceStatusBanner",
              extra: { openBreakers: active },
            },
          );
        }
      }
    } catch {
      // Non-blocking telemetry poll
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  const handleReset = async (name: string) => {
    setResetting(name);
    try {
      await orchestratorClient.resetCircuitBreaker(name);
      await fetchStatus();
    } catch (err: any) {
      captureClientError(err, {
        component: "ResilienceStatusBanner",
        action: "resetCircuitBreaker",
        extra: { breakerName: name },
      });
    } finally {
      setResetting(null);
    }
  };

  return (
    <div className={`flex flex-col w-full ${className}`}>
      {/* Circuit Breaker Status Banner */}
      {openBreakers.map((breaker) => {
        const isOpen = breaker.state === "open";
        const bgStyle = isOpen
          ? "bg-rose-950/90 border-rose-500/40 text-rose-200"
          : "bg-amber-950/90 border-amber-500/40 text-amber-200";

        const badgeStyle = isOpen
          ? "bg-rose-500/30 text-rose-300 border-rose-500/50"
          : "bg-amber-500/30 text-amber-300 border-amber-500/50";

        return (
          <div
            key={breaker.name}
            role="alert"
            className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-3 text-xs font-mono backdrop-blur-md z-30 transition-all ${bgStyle}`}
          >
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${badgeStyle}`}
              >
                {isOpen ? "Circuit Breaker Tripped" : "Canary Probe Trial"}
              </span>
              <span className="font-semibold">{breaker.name}</span>
              <span className="opacity-80">
                {isOpen
                  ? `Upstream provider failing fast (${breaker.failureCount ?? 5} failures recorded). Auto-recovery active.`
                  : "Testing upstream provider recovery with canary requests."}
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => void handleReset(breaker.name)}
                disabled={resetting === breaker.name}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white font-sans text-xs transition-colors disabled:opacity-50"
              >
                {resetting === breaker.name ? "Resetting..." : "Reset Breaker"}
              </button>
              <Link
                href="/settings"
                className="px-2.5 py-1 rounded border border-white/20 hover:border-white/40 text-white/90 font-sans text-xs transition-colors"
              >
                Settings
              </Link>
            </div>
          </div>
        );
      })}

      {/* Rate Limit Status Banner */}
      {isRateLimited && (
        <div
          role="alert"
          className="px-4 py-2 bg-amber-950/90 border-b border-amber-500/40 text-amber-200 flex items-center justify-between text-xs font-mono backdrop-blur-md z-30"
        >
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded border border-amber-500/50 bg-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
              Rate Limit Active
            </span>
            <span>
              Request quota reached. Automatic token bucket refill in progress.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsRateLimited(false)}
            className="text-amber-300/70 hover:text-amber-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Decorated Children UI */}
      {children}
    </div>
  );
}
