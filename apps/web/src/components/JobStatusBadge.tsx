"use client";

import * as React from "react";
import {
  Server,
  Clock,
  AlertOctagon,
  CheckCircle2,
  Flame,
  Loader2,
} from "lucide-react";

export type KubernetesJobPhase =
  | "Queued"
  | "ScalingUp"
  | "Pending"
  | "Running"
  | "Succeeded"
  | "Completed"
  | "Failed"
  | "OOMKilled"
  | "Evicted"
  | string;

export interface JobStatusBadgeProps {
  phase?: KubernetesJobPhase;
  podName?: string;
  jobName?: string;
  nodeName?: string;
  namespace?: string;
  oomKilled?: boolean;
  evicted?: boolean;
  durationMs?: number;
  className?: string;
}

export function JobStatusBadge({
  phase = "Running",
  podName,
  jobName,
  nodeName,
  namespace = "crucible",
  oomKilled = false,
  evicted = false,
  durationMs,
  className = "",
}: JobStatusBadgeProps) {
  const isOOM = oomKilled || phase === "OOMKilled";
  const isEvicted = evicted || phase === "Evicted";
  const isQueued = phase === "Queued";
  const isScalingUp = phase === "ScalingUp";
  const isPending = phase === "Pending";
  const isRunning = phase === "Running" && !isOOM && !isEvicted && !isScalingUp;
  const isSucceeded = phase === "Succeeded" || phase === "Completed";
  const isFailed = (phase === "Failed" || isOOM || isEvicted) && !isSucceeded;

  let badgeColor = "bg-zinc-900 border-white/10 text-zinc-300";
  let label = phase;
  let Icon: React.ComponentType<{ size?: number; className?: string }> = Server;

  if (isOOM) {
    badgeColor = "bg-rose-950/60 border-rose-500/40 text-rose-300";
    label = "OOMKilled";
    Icon = Flame;
  } else if (isEvicted) {
    badgeColor = "bg-rose-950/60 border-rose-500/40 text-rose-300";
    label = "Evicted";
    Icon = AlertOctagon;
  } else if (isQueued) {
    badgeColor = "bg-sky-950/40 border-sky-500/30 text-sky-300";
    label = "Job Queued";
    Icon = Clock;
  } else if (isScalingUp) {
    badgeColor = "bg-violet-950/40 border-violet-500/30 text-violet-300";
    label = "Scaling Up (Node)";
    Icon = Loader2;
  } else if (isPending) {
    badgeColor = "bg-amber-950/40 border-amber-500/30 text-amber-300";
    label = "K8s Pending";
    Icon = Clock;
  } else if (isRunning) {
    badgeColor = "bg-zinc-900/90 border-white/10 text-zinc-200";
    label = "Pod Running";
    Icon = Server;
  } else if (isSucceeded) {
    badgeColor = "bg-zinc-900 border-white/10 text-neutral-300";
    label = "Succeeded";
    Icon = CheckCircle2;
  } else if (isFailed) {
    badgeColor = "bg-rose-950/40 border-rose-500/30 text-rose-300";
    label = "Failed";
    Icon = AlertOctagon;
  }

  const tooltip = `Namespace: ${namespace} | Job: ${jobName || "crucible-job"} | Pod: ${podName || "pending"} | Node: ${nodeName || "cluster-node"}${durationMs ? ` | Duration: ${Math.round(durationMs / 1000)}s` : ""}`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono tracking-tight ${badgeColor} ${className}`}
      title={tooltip}
    >
      <Icon
        size={11}
        className={isPending || isScalingUp ? "animate-spin" : "shrink-0"}
      />
      <span className="font-semibold">{label}</span>
      {podName && (
        <span className="opacity-50 font-normal">{podName.slice(-6)}</span>
      )}
    </div>
  );
}
