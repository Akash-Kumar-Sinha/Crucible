"use client";

import * as React from "react";
import type { SquadInfo } from "@/api/orchestrator-client";
import { RoleAvatar } from "@/components/workspace/RoleAvatar";
import { FindingCard, type Finding } from "@/components/squads/FindingCard";
import {
  Code2,
  CheckCircle2,
  ShieldAlert,
  Wrench,
  Play,
  Clock,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/ui/prompt-input";

export interface SquadBoardProps {
  squad?: SquadInfo;
  findings?: Finding[];
  onStartSquad?: (goal: string) => Promise<void>;
  onTransition?: (stage: string, reason: string) => Promise<void>;
  isLoading?: boolean;
}

const STAGES: Array<{
  id: "coding" | "testing" | "auditing" | "fixing" | "completed";
  label: string;
  role: "coder" | "test_writer" | "bug_hunter" | "bug_fixer" | "general";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  accentClass: string;
  badgeClass: string;
}> = [
  {
    id: "coding",
    label: "1. Coding",
    role: "coder",
    icon: Code2,
    description: "Generates implementation and initial solution",
    accentClass: "border-sky-500/40 bg-sky-950/20",
    badgeClass: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  },
  {
    id: "testing",
    label: "2. Test Writing & QA",
    role: "test_writer",
    icon: CheckCircle2,
    description: "Authors comprehensive test suites and executes validations",
    accentClass: "border-emerald-500/40 bg-emerald-950/20",
    badgeClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  {
    id: "auditing",
    label: "3. Red-Team Hunting",
    role: "bug_hunter",
    icon: ShieldAlert,
    description: "Air-gapped adversarial exploit and fault discovery",
    accentClass: "border-rose-500/40 bg-rose-950/25 ring-1 ring-rose-500/30",
    badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/40 font-bold",
  },
  {
    id: "fixing",
    label: "4. Surgical Bug Fixing",
    role: "bug_fixer",
    icon: Wrench,
    description: "Diagnoses root-causes and issues targeted patches",
    accentClass: "border-amber-500/40 bg-amber-950/20",
    badgeClass: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
  {
    id: "completed",
    label: "5. Verified Resolution",
    role: "general",
    icon: Sparkles,
    description: "All automated tests passing and zero security findings",
    accentClass: "border-emerald-500/50 bg-emerald-950/30",
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
];

export function SquadBoard({
  squad,
  findings = [],
  onStartSquad,
  onTransition: _onTransition,
  isLoading = false,
}: SquadBoardProps) {
  const [goalInput, setGoalInput] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [selectedMobileTab, setSelectedMobileTab] = React.useState<
    "coding" | "testing" | "auditing" | "fixing" | "completed" | "findings"
  >("coding");

  // Format stage duration
  const now = Date.now();
  const stageElapsedMs = squad?.stageStartedAt
    ? Math.max(0, now - squad.stageStartedAt)
    : 0;
  const stageElapsedSec = Math.floor(stageElapsedMs / 1000);
  const isStalled =
    squad?.stage === "stalled" ||
    (squad?.stageTimeoutMs &&
      squad?.stage !== "idle" &&
      squad?.stage !== "completed" &&
      squad?.stage !== "failed" &&
      stageElapsedMs > squad.stageTimeoutMs);

  const handleStart = async () => {
    if (!goalInput.trim() || !onStartSquad) return;
    try {
      setStarting(true);
      await onStartSquad(goalInput);
      setGoalInput("");
    } finally {
      setStarting(false);
    }
  };

  // If no squad provided, show empty state
  if (!squad) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px] p-8 text-center rounded-lg border border-white/8 bg-zinc-900/60 font-mono">
        <Layers size={36} className="text-zinc-600 mb-3 animate-pulse" />
        <h2 className="text-base font-semibold text-zinc-300">
          No Multi-Agent Squad Selected
        </h2>
        <p className="text-xs text-zinc-500 mt-1 max-w-sm">
          Select or provision an autonomous squad to view the live Kanban
          hand-off pipeline and security audit trail.
        </p>
      </div>
    );
  }

  const activeStageId = squad.stage === "stalled" ? "auditing" : squad.stage;

  return (
    <div className="flex flex-col h-full space-y-4 font-mono select-none">
      {/* Squad Header Bar */}
      <div className="rounded-lg border border-white/8 bg-zinc-900/80 p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-base font-bold text-white tracking-tight">
                {squad.name}
              </h1>
              <span className="text-[10px] text-zinc-500 font-mono">
                ({squad.id})
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  isStalled
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                    : squad.stage === "completed"
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      : "bg-sky-500/20 text-sky-300 border-sky-500/30"
                }`}
              >
                Stage: {squad.stage}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              {squad.statusLine || "Awaiting task execution..."}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Fix Iterations Counter */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/8 bg-black/40 text-xs text-zinc-300">
              <RefreshCw size={12} className="text-amber-400" />
              <span>
                Fix Loop: {squad.fixIterationCount} / {squad.maxFixIterations}
              </span>
            </div>

            {/* Stage Timer */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/8 bg-black/40 text-xs text-zinc-300">
              <Clock size={12} className="text-sky-400" />
              <span>{stageElapsedSec}s in stage</span>
            </div>
          </div>
        </div>

        {/* Squad Members Roster */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
          <span className="text-[11px] text-zinc-500 mr-1 font-semibold">
            Roster:
          </span>
          {Object.entries(squad.members || {}).map(([roleKey, member]) => (
            <RoleAvatar
              key={roleKey}
              role={member.role}
              sessionId={member.sessionId}
              model={member.model}
              active={
                squad.activeRole === member.role ||
                (squad.stage === "coding" && member.role === "coder") ||
                (squad.stage === "testing" && member.role === "test_writer") ||
                (squad.stage === "auditing" && member.role === "bug_hunter") ||
                (squad.stage === "fixing" && member.role === "bug_fixer")
              }
              size="sm"
            />
          ))}
        </div>

        {/* Squad Goal Prompt Launcher if Idle */}
        {squad.stage === "idle" && (
          <div className="pt-2">
            <div className="flex items-center gap-2">
              <PromptInput
                value={goalInput}
                onChange={setGoalInput}
                onSubmit={() => {
                  void handleStart();
                }}
                isLoading={starting || isLoading}
                placeholder="Assign an objective to the squad (e.g. Build JWT auth module and audit security)..."
                className="w-full text-xs"
              />
              <Button
                type="button"
                onClick={() => void handleStart()}
                disabled={starting || !goalInput.trim()}
                className="h-10 px-4 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shrink-0"
              >
                <Play size={13} className="mr-1.5" />
                Start Squad
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Health Check Stall Alert Banner */}
      {isStalled && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3.5 flex items-center justify-between gap-3 text-xs font-mono text-rose-200">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300">
              <AlertTriangle size={16} className="animate-bounce" />
            </div>
            <div>
              <div className="font-bold uppercase tracking-wider text-[11px] text-rose-300">
                Squad Workflow Stalled
              </div>
              <div className="text-[11px] text-rose-200/90">
                Stage &apos;{squad.stage}&apos; exceeded timeout threshold (
                {Math.floor(squad.stageTimeoutMs / 1000)}s) without automated
                hand-off progress.
              </div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-rose-500/30 text-rose-200 text-[10px] font-bold uppercase shrink-0">
            Alert: Timeout
          </span>
        </div>
      )}

      {/* Mobile Stage Selector Tabs (Collapses Kanban for narrow viewports) */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelectedMobileTab(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-all border ${
              selectedMobileTab === s.id
                ? `${s.badgeClass} bg-zinc-800`
                : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelectedMobileTab("findings")}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium whitespace-nowrap transition-all border ${
            selectedMobileTab === "findings"
              ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
              : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Findings ({findings.length})
        </button>
      </div>

      {/* Desktop Kanban Board Columns & Mobile Viewport Tabs */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3.5 min-h-0 overflow-y-auto">
        {STAGES.filter((s) => s.id !== "completed").map((stageItem) => {
          const isActive =
            activeStageId === stageItem.id ||
            (stageItem.id === "coding" && squad.stage === "coding") ||
            (stageItem.id === "testing" && squad.stage === "testing") ||
            (stageItem.id === "auditing" && squad.stage === "auditing") ||
            (stageItem.id === "fixing" && squad.stage === "fixing");

          const Icon = stageItem.icon;
          const assignedMember = squad.members?.[stageItem.role];

          // Filter mobile display
          const isMobileVisible =
            selectedMobileTab === stageItem.id || typeof window === "undefined";

          return (
            <div
              key={stageItem.id}
              className={`flex flex-col rounded-lg border transition-all p-4 space-y-3 ${
                isActive
                  ? `${stageItem.accentClass} shadow-md`
                  : "border-white/8 bg-zinc-900/40 opacity-75"
              } ${isMobileVisible ? "flex" : "hidden lg:flex"}`}
            >
              {/* Stage Header */}
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${stageItem.badgeClass} flex items-center justify-center`}
                  >
                    <Icon size={14} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white">
                      {stageItem.label}
                    </h3>
                    <p className="text-[10px] text-zinc-500">
                      {stageItem.role}
                    </p>
                  </div>
                </div>

                {isActive && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>

              <p className="text-[11px] text-zinc-400 leading-relaxed min-h-[32px]">
                {stageItem.description}
              </p>

              {/* Assigned Role Member */}
              {assignedMember && (
                <div className="p-2.5 rounded-lg border border-white/5 bg-black/40 space-y-1.5">
                  <div className="text-[10px] text-zinc-500 font-semibold uppercase">
                    Active Executor:
                  </div>
                  <RoleAvatar
                    role={assignedMember.role}
                    sessionId={assignedMember.sessionId}
                    model={assignedMember.model}
                    active={isActive}
                    size="sm"
                  />
                </div>
              )}

              {/* Stage Activity Log / Handoff History Snippet */}
              <div className="flex-1 flex flex-col justify-end pt-2 text-[10px] text-zinc-500">
                {isActive ? (
                  <div className="p-2 rounded-lg bg-white/5 border border-white/8 text-zinc-300 space-y-1">
                    <div className="font-semibold text-[10px] text-sky-400 flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin" />
                      Stage In Progress
                    </div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      {squad.statusLine}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2 text-zinc-600 font-mono text-[10px]">
                    Waiting for pipeline hand-off...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bug Hunter Findings Stream Drawer */}
      <div className="rounded-lg border border-white/8 bg-zinc-900/60 p-4 space-y-3 font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-rose-400" />
            <h3 className="text-xs font-bold text-zinc-200">
              Bug Hunter & QA Findings Feed ({findings.length})
            </h3>
          </div>

          <span className="text-[10px] text-zinc-500 font-mono">
            Tamper-Evident Audit Ledger
          </span>
        </div>

        {findings.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500 bg-black/30 rounded-lg border border-white/5">
            No vulnerability findings or test failures detected yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
