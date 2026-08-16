"use client";

import * as React from "react";
import { Server, Clock, AlertOctagon, CheckCircle2, Flame } from "lucide-react";

export type KubernetesSchedulingPhase =
  | "Queued"
  | "ScalingUp"
  | "Pending"
  | "Running"
  | "Succeeded"
  | "Failed"
  | "OOMKilled"
  | "Evicted"
  | string;

export interface SchedulingStatusBadgeProps {
  phase?: KubernetesSchedulingPhase;
  podName?: string;
  jobName?: string;
  nodeName?: string;
  oomKilled?: boolean;
  evicted?: boolean;
  className?: string;
}

export function SchedulingStatusBadge({
  phase = "Running",
  podName,
  jobName,
  nodeName,
  oomKilled = false,
  evicted = false,
  className = "",
}: SchedulingStatusBadgeProps) {
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
  let Icon = Server;

  if (isOOM) {
    badgeColor = "bg-rose-950/60 border-rose-500/40 text-rose-300";
    label = "Pod OOMKilled";
    Icon = Flame;
  } else if (isEvicted) {
    badgeColor = "bg-rose-950/60 border-rose-500/40 text-rose-300";
    label = "Pod Evicted";
    Icon = AlertOctagon;
  } else if (isQueued) {
    badgeColor = "bg-sky-950/40 border-sky-500/30 text-sky-300";
    label = "Job Queued (Load Leveling)";
    Icon = Clock;
  } else if (isScalingUp) {
    badgeColor = "bg-violet-950/40 border-violet-500/30 text-violet-300";
    label = "Scaling Up (Cold-Start)";
    Icon = Clock;
  } else if (isPending) {
    badgeColor = "bg-amber-950/40 border-amber-500/30 text-amber-300";
    label = "Job Scheduling (Pending)";
    Icon = Clock;
  } else if (isRunning) {
    badgeColor = "bg-zinc-900/80 border-white/10 text-zinc-300";
    label = "Pod Running";
    Icon = Server;
  } else if (isSucceeded) {
    badgeColor = "bg-zinc-900 border-white/10 text-neutral-300";
    label = "Job Completed";
    Icon = CheckCircle2;
  } else if (isFailed) {
    badgeColor = "bg-rose-950/40 border-rose-500/30 text-rose-300";
    label = "Job Failed";
    Icon = AlertOctagon;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono tracking-tight ${badgeColor} ${className}`}
      title={`Kubernetes Job: ${jobName || "crucible-job"} | Pod: ${podName || "pending"} | Node: ${nodeName || "cluster-node"} | Status: ${label}`}
    >
      <Icon size={11} className={isPending ? "animate-spin" : "shrink-0"} />
      <span className="font-semibold">{label}</span>
      {podName && (
        <span className="opacity-50 font-normal">{podName.slice(-6)}</span>
      )}
    </div>
  );
}
