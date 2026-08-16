import type { AgentRoleId } from "../roles/types";
import type { SquadStage, HandoffDecision } from "./types";

/**
 * Pure function evaluating hand-off transitions between squad roles
 */
export function evaluateHandoffRules(params: {
  currentStage: SquadStage;
  triggerRole: AgentRoleId;
  output: string;
  error?: string;
  fixIterationCount: number;
  maxFixIterations: number;
}): HandoffDecision {
  const {
    currentStage,
    triggerRole,
    output,
    error,
    fixIterationCount,
    maxFixIterations,
  } = params;

  const normalizedOutput = (output + (error ? `\n${error}` : "")).toLowerCase();

  // STAGE 1: Coding finished -> Hand off to Test Writer
  if (currentStage === "coding" || triggerRole === "coder") {
    return {
      nextStage: "testing",
      targetRole: "test_writer",
      messageType: "delegation",
      task: "Verify the implementation by writing unit/integration test suites and verifying all acceptance criteria.",
      reason:
        "Coder finished implementation -> notifying Test Writer to construct test suite",
    };
  }

  // STAGE 2: Test Writer finished -> Hand off to Bug Hunter or Bug Fixer
  if (currentStage === "testing" || triggerRole === "test_writer") {
    const hasFailures =
      Boolean(error) ||
      normalizedOutput.includes("test failed") ||
      normalizedOutput.includes("failed:") ||
      normalizedOutput.includes("failures:") ||
      normalizedOutput.includes("assertionerror") ||
      normalizedOutput.includes("exit code 1") ||
      normalizedOutput.includes("tests failed");

    if (hasFailures) {
      if (fixIterationCount >= maxFixIterations) {
        return {
          nextStage: "failed",
          messageType: "notification",
          task: `Squad workflow failed after reaching maximum repair iterations (${maxFixIterations}).`,
          reason: `Test failures persisted past iteration limit of ${maxFixIterations}`,
        };
      }
      return {
        nextStage: "fixing",
        targetRole: "bug_fixer",
        messageType: "delegation",
        task: "Investigate test failures and author surgical patches to satisfy test requirements.",
        reason:
          "Test Writer detected test failures -> notifying Bug Fixer to author patches",
        findings: output,
      };
    }

    // Tests passed -> hand off to Bug Hunter for read-only security/edge-case audit
    return {
      nextStage: "auditing",
      targetRole: "bug_hunter",
      messageType: "delegation",
      task: "Perform read-only security audit, edge-case probing, and boundary vulnerability exploitation against implementation.",
      reason:
        "Tests passed cleanly -> notifying Bug Hunter for security and edge-case probing",
    };
  }

  // STAGE 3: Bug Hunter finished -> Hand off to Bug Fixer or Complete
  if (currentStage === "auditing" || triggerRole === "bug_hunter") {
    const hasVulnerabilities =
      normalizedOutput.includes("vulnerability found") ||
      normalizedOutput.includes("vulnerability:") ||
      normalizedOutput.includes("bug found") ||
      normalizedOutput.includes("exploit:") ||
      normalizedOutput.includes("severity: high") ||
      normalizedOutput.includes("severity: critical") ||
      normalizedOutput.includes("flaw detected") ||
      normalizedOutput.includes("edge case bug");

    if (hasVulnerabilities) {
      if (fixIterationCount >= maxFixIterations) {
        return {
          nextStage: "failed",
          messageType: "notification",
          task: `Squad workflow failed after reaching maximum repair iterations (${maxFixIterations}) during audit.`,
          reason: `Vulnerabilities unresolved after maximum iteration limit of ${maxFixIterations}`,
        };
      }
      return {
        nextStage: "fixing",
        targetRole: "bug_fixer",
        messageType: "delegation",
        task: "Patch security flaws and edge-case vulnerabilities identified by Bug Hunter.",
        reason:
          "Bug Hunter surfaced vulnerabilities -> notifying Bug Fixer to patch flaws",
        findings: output,
      };
    }

    // Clean audit -> Complete
    return {
      nextStage: "completed",
      messageType: "notification",
      task: "Squad workflow completed successfully. Implementation verified by Test Writer and passed Bug Hunter audit.",
      reason:
        "Bug Hunter audit clean with zero vulnerabilities -> workflow completed",
    };
  }

  // STAGE 4: Bug Fixer finished -> Hand back to Test Writer for regression checks
  if (currentStage === "fixing" || triggerRole === "bug_fixer") {
    if (fixIterationCount >= maxFixIterations) {
      return {
        nextStage: "failed",
        messageType: "notification",
        task: `Squad workflow failed after reaching maximum repair iterations (${maxFixIterations}).`,
        reason: `Exceeded maximum iteration limit of ${maxFixIterations}`,
      };
    }

    return {
      nextStage: "testing",
      targetRole: "test_writer",
      messageType: "delegation",
      task: "Re-run full test suite against updated patch to verify fix and ensure zero regressions.",
      reason:
        "Bug Fixer authored patch -> notifying Test Writer to re-verify test suite",
    };
  }

  // Fallback
  return {
    nextStage: "completed",
    messageType: "notification",
    task: "Squad completed all stages.",
    reason: "Stage sequence concluded",
  };
}
