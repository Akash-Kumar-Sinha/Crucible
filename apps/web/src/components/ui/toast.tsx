"use client";

import * as React from "react";

export interface ToastProps {
  id?: string;
  type?:
    "info" | "warning" | "error" | "success" | "rate_limit" | "circuit_breaker";
  title: string;
  message?: string;
  retryAfterSeconds?: number;
  onDismiss?: () => void;
}

export function Toast({
  type = "info",
  title,
  message,
  retryAfterSeconds,
  onDismiss,
}: ToastProps) {
  const [secondsRemaining, setSecondsRemaining] = React.useState<
    number | undefined
  >(retryAfterSeconds);

  React.useEffect(() => {
    if (secondsRemaining === undefined || secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev === undefined || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const isRateLimit = type === "rate_limit" || type === "warning";
  const isBreaker = type === "circuit_breaker" || type === "error";

  const borderColor = isRateLimit
    ? "border-amber-500/40 bg-amber-950/80 text-amber-200"
    : isBreaker
      ? "border-red-500/40 bg-red-950/80 text-red-200"
      : "border-zinc-700 bg-zinc-900/90 text-zinc-100";

  return (
    <div
      role="alert"
      className={`fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-3 rounded-lg border p-4 shadow-xl backdrop-blur-md transition-all ${borderColor}`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{title}</span>
          {secondsRemaining !== undefined && secondsRemaining > 0 && (
            <span className="rounded bg-black/40 px-1.5 py-0.5 text-xs font-mono">
              Retry in {secondsRemaining}s
            </span>
          )}
        </div>
        {message && <p className="mt-1 text-xs opacity-90">{message}</p>}
      </div>

      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-2 rounded p-1 text-xs opacity-70 hover:opacity-100"
          aria-label="Dismiss alert"
        >
          ✕
        </button>
      )}
    </div>
  );
}
