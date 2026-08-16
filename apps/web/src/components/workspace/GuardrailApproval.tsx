"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Terminal,
  Clock,
  UserCheck,
} from "lucide-react";
import { orchestratorClient } from "@/api/orchestrator-client";
import { useSessionStore } from "@/stores/session-store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface GuardrailApprovalProps {
  sessionId: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  policyReason?: string;
  onDecisionComplete?: (action: "approved" | "rejected") => void;
}

export function GuardrailApproval({
  sessionId,
  toolName = "bash_exec",
  toolCallId,
  args,
  policyReason,
  onDecisionComplete,
}: GuardrailApprovalProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [decision, setDecision] = React.useState<
    "approved" | "rejected" | null
  >(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [denyReason, setDenyReason] = React.useState("");
  const [showDenyInput, setShowDenyInput] = React.useState(false);

  const setStatus = useSessionStore((s) => s.setStatus);

  const commandText = React.useMemo(() => {
    if (!args) return null;
    if (typeof args.command === "string") return args.command;
    if (typeof args.cmd === "string") return args.cmd;
    if (typeof args.input === "string") return args.input;
    if (typeof args.expression === "string") return args.expression;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }, [args]);

  const handleDecision = async (approved: boolean) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await orchestratorClient.approveGuardrailAction(sessionId, {
        approved,
        reason: approved
          ? undefined
          : denyReason.trim() || "Rejected by human operator via UI",
        toolCallId,
        operatorId: "operator_ui",
        resume: true,
      });

      const nextAction = res.action;
      setDecision(nextAction);
      setStatus((res.status as any) || "running");

      if (onDecisionComplete) {
        onDecisionComplete(nextAction);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message || "Failed to submit guardrail approval decision.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const iconTone =
    decision === "approved"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
      : decision === "rejected"
        ? "border-rose-500/30 bg-rose-500/15 text-rose-400"
        : "border-amber-500/30 bg-amber-500/15 text-amber-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className="my-4"
    >
      <Card className="border border-white/8 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
        <CardHeader>
          <div className="col-span-1 flex min-w-0 items-start gap-3">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${iconTone}`}
            >
              {decision === "approved" ? (
                <CheckCircle2 size={16} />
              ) : decision === "rejected" ? (
                <XCircle size={16} />
              ) : (
                <ShieldAlert size={16} />
              )}
            </div>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {decision === "approved"
                  ? "Action Approved by Operator"
                  : decision === "rejected"
                    ? "Action Rejected by Operator"
                    : "Human Checkpoint: Approval Required"}
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                  {toolName}
                </span>
              </CardTitle>
              <CardDescription className="mt-1">
                {policyReason ||
                  "Execution paused by policy engine before executing potentially dangerous operation."}
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <div className="flex items-center gap-1.5 text-[11px] text-white/50">
              <Clock size={12} />
              <span>{decision ? "Resolved" : "Awaiting Review"}</span>
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-3">
          {commandText && (
            <div className="flex items-start gap-2 overflow-x-auto rounded-lg border border-white/8 bg-black/40 px-3 py-2.5 text-xs text-white/85">
              <Terminal size={14} className="mt-0.5 shrink-0 text-white/50" />
              <pre className="m-0 whitespace-pre-wrap break-all">
                {commandText}
              </pre>
            </div>
          )}

          {showDenyInput && !decision && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex flex-col gap-1.5"
            >
              <label className="text-[11px] text-white/60">
                Reason for rejection (optional):
              </label>
              <input
                type="text"
                placeholder="e.g. Command modifies root filesystem without backup"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                className="w-full rounded-lg border border-white/12 bg-black/40 px-2.5 py-2 text-xs text-white outline-none focus:border-white/30"
              />
            </motion.div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertTriangle size={14} />
              <span>{errorMessage}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-end">
          {!decision ? (
            <>
              {!showDenyInput ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDenyInput(true)}
                  disabled={isSubmitting}
                  className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <XCircle data-icon="inline-start" />
                  Deny
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDecision(false)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <XCircle data-icon="inline-start" />
                  )}
                  Confirm Deny
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                onClick={() => handleDecision(true)}
                disabled={isSubmitting}
                className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium"
              >
                {isSubmitting ? (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin text-zinc-950"
                  />
                ) : (
                  <UserCheck data-icon="inline-start" />
                )}
                Approve & Execute
              </Button>
            </>
          ) : (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium ${
                decision === "approved" ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {decision === "approved" ? (
                <CheckCircle2 size={14} />
              ) : (
                <XCircle size={14} />
              )}
              <span>Decision recorded and logged. Execution resumed.</span>
            </div>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}
