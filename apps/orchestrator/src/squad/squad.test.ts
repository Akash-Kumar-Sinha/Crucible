import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Squad } from "./squad";
import { SquadManager, resetSquadManager } from "./squad-manager";
import { evaluateHandoffRules } from "./handoff-rules";
import { SessionManager } from "../session/session-manager";
import { getSessionBus } from "../session/session-bus";
import { getErrorReporter } from "../observability/error-reporter";

describe("Multi-Agent Squad Orchestration", () => {
  beforeEach(() => {
    resetSquadManager();
    getSessionBus().clear();
    getErrorReporter().resetMetrics();
  });

  afterEach(() => {
    resetSquadManager();
    getSessionBus().clear();
  });

  describe("Handoff Rules (Pure Function Evaluation)", () => {
    it("should route from Coder completion to Test Writer", () => {
      const decision = evaluateHandoffRules({
        currentStage: "coding",
        triggerRole: "coder",
        output: "Implemented Authentication Middleware with JWT support",
        fixIterationCount: 0,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("testing");
      expect(decision.targetRole).toBe("test_writer");
      expect(decision.messageType).toBe("delegation");
      expect(decision.reason).toContain("notifying Test Writer");
    });

    it("should route from Test Writer failure to Bug Fixer", () => {
      const decision = evaluateHandoffRules({
        currentStage: "testing",
        triggerRole: "test_writer",
        output:
          "Tests run: 5, Failures: 1. AssertionError: expected 200 but received 401",
        error: "Test suite exit code 1",
        fixIterationCount: 0,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("fixing");
      expect(decision.targetRole).toBe("bug_fixer");
      expect(decision.findings).toBeDefined();
    });

    it("should route from Test Writer success to Bug Hunter audit", () => {
      const decision = evaluateHandoffRules({
        currentStage: "testing",
        triggerRole: "test_writer",
        output: "All 12 unit tests passed cleanly in 45ms. 0 failures.",
        fixIterationCount: 0,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("auditing");
      expect(decision.targetRole).toBe("bug_hunter");
    });

    it("should route from Bug Hunter vulnerabilities to Bug Fixer", () => {
      const decision = evaluateHandoffRules({
        currentStage: "auditing",
        triggerRole: "bug_hunter",
        output:
          "Vulnerability Found: Missing timing-safe string comparison on HMAC token.",
        fixIterationCount: 0,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("fixing");
      expect(decision.targetRole).toBe("bug_fixer");
    });

    it("should complete workflow when Bug Hunter finds zero vulnerabilities", () => {
      const decision = evaluateHandoffRules({
        currentStage: "auditing",
        triggerRole: "bug_hunter",
        output:
          "Security Audit passed: No vulnerabilities found across authorization paths.",
        fixIterationCount: 0,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("completed");
    });

    it("should route from Bug Fixer back to Test Writer for regression testing", () => {
      const decision = evaluateHandoffRules({
        currentStage: "fixing",
        triggerRole: "bug_fixer",
        output: "Patched HMAC verification using crypto.timingSafeEqual().",
        fixIterationCount: 1,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("testing");
      expect(decision.targetRole).toBe("test_writer");
    });

    it("should transition to failed if fix iteration count exceeds maxFixIterations", () => {
      const decision = evaluateHandoffRules({
        currentStage: "fixing",
        triggerRole: "bug_fixer",
        output: "Still failing edge case",
        fixIterationCount: 5,
        maxFixIterations: 5,
      });

      expect(decision.nextStage).toBe("failed");
    });
  });

  describe("Squad State Machine & Lifecycle", () => {
    it("should initialize in idle state and start pipeline by dispatching to Coder", async () => {
      const squad = new Squad({
        name: "Security Engineering Squad",
        members: {
          coder: "sess_coder_1",
          test_writer: "sess_tw_1",
          bug_hunter: "sess_bh_1",
          bug_fixer: "sess_bf_1",
        },
      });

      expect(squad.getStage()).toBe("idle");
      const summary = await squad.start("Build OAuth2 Refresh Token Rotation");

      expect(squad.getStage()).toBe("coding");
      expect(summary.activeGoal).toBe("Build OAuth2 Refresh Token Rotation");
      expect(summary.history.length).toBe(1);
      expect(summary.history[0].toStage).toBe("coding");
    });

    it("should advance stages and publish inter-session messages on turn completions", async () => {
      const squad = new Squad({
        name: "Feature Delivery Squad",
        members: {
          coder: "sess_coder_2",
          test_writer: "sess_tw_2",
          bug_hunter: "sess_bh_2",
          bug_fixer: "sess_bf_2",
        },
      });

      await squad.start("Implement rate limiter");

      // Coder finishes turn
      await squad.handleTurnCompleted(
        "coder",
        "sess_coder_2",
        "Implemented token bucket algorithm",
      );
      expect(squad.getStage()).toBe("testing");

      // Test writer passes
      await squad.handleTurnCompleted(
        "test_writer",
        "sess_tw_2",
        "All tests passed cleanly. 100% coverage.",
      );
      expect(squad.getStage()).toBe("auditing");

      // Bug hunter finds flaw
      await squad.handleTurnCompleted(
        "bug_hunter",
        "sess_bh_2",
        "Bug found: Race condition under concurrent requests.",
      );
      expect(squad.getStage()).toBe("fixing");

      // Bug fixer repairs
      await squad.handleTurnCompleted(
        "bug_fixer",
        "sess_bf_2",
        "Added mutex lock around token replenish cycle.",
      );
      expect(squad.getStage()).toBe("testing");

      // Test writer re-verifies
      await squad.handleTurnCompleted(
        "test_writer",
        "sess_tw_2",
        "All tests passed cleanly including concurrency stress tests.",
      );
      expect(squad.getStage()).toBe("auditing");

      // Bug hunter clean audit
      await squad.handleTurnCompleted(
        "bug_hunter",
        "sess_bh_2",
        "Audit passed. No vulnerabilities detected.",
      );
      expect(squad.getStage()).toBe("completed");
    });

    it("should detect stalled stages past timeout limit and trigger structured alert", async () => {
      let alertTriggered = false;
      const errorReporter = getErrorReporter();
      errorReporter.on("squadStalledAlert", () => {
        alertTriggered = true;
      });

      const squad = new Squad({
        name: "Fast Stalling Squad",
        stageTimeoutMs: 20, // 20ms for fast testing
        members: {
          coder: "sess_coder_stall",
          test_writer: "sess_tw_stall",
        },
      });

      await squad.start("Do something");
      expect(squad.getStage()).toBe("coding");

      await new Promise((r) => setTimeout(r, 40));

      const isStalled = squad.checkStall();
      expect(isStalled).toBe(true);
      expect(squad.getStage()).toBe("stalled");
      expect(alertTriggered).toBe(true);
    });
  });

  describe("SquadManager (Mediator pattern)", () => {
    it("should auto-provision role sessions when created through SquadManager", async () => {
      const sessionManager = new SessionManager({
        defaultMaxSteps: 5,
        autoPersist: false,
      });
      const squadManager = new SquadManager(sessionManager);

      const squad = await squadManager.createSquad({
        name: "Auto-Provisioned Squad",
        autoCreateSessions: true,
      });

      expect(squad).toBeDefined();
      const members = squad.getMembers();
      expect(members.has("coder")).toBe(true);
      expect(members.has("test_writer")).toBe(true);
      expect(members.has("bug_hunter")).toBe(true);
      expect(members.has("bug_fixer")).toBe(true);

      const coderSession = sessionManager.get(members.get("coder")!.sessionId);
      expect(coderSession).toBeDefined();
      expect(coderSession?.metadata?.role).toBe("coder");
      expect(coderSession?.metadata?.squadId).toBe(squad.id);

      squadManager.clear();
    });
  });
});
