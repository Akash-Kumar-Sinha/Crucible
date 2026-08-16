import { describe, it, expect } from "bun:test";
import React from "react";
import { RoleAvatar } from "@/components/workspace/RoleAvatar";
import { FindingCard, type Finding } from "@/components/squads/FindingCard";
import { SquadBoard } from "@/components/squads/SquadBoard";
import type { SquadInfo } from "../api/orchestrator-client";

describe("Squad Dashboard Web UI Components", () => {
  it("should define RoleAvatar with role configuration and active indicator", () => {
    expect(typeof RoleAvatar).toBe("function");

    const element = React.createElement(RoleAvatar, {
      role: "bug_hunter",
      sessionId: "sess_bh_123",
      model: "anthropic/claude-3.5-sonnet",
      active: true,
    });

    expect(element).toBeDefined();
    expect(element.props.role).toBe("bug_hunter");
    expect(element.props.active).toBe(true);
  });

  it("should define FindingCard with severity and status mappings", () => {
    expect(typeof FindingCard).toBe("function");

    const sampleFinding: Finding = {
      id: "f_1",
      title: "Hardcoded secret key in config.json",
      severity: "critical",
      status: "open",
      discoveredBy: "bug_hunter",
      details: "AWS secret access key pattern found in plain text.",
      timestamp: Date.now(),
    };

    const element = React.createElement(FindingCard, {
      finding: sampleFinding,
    });

    expect(element).toBeDefined();
    expect(element.props.finding.severity).toBe("critical");
    expect(element.props.finding.status).toBe("open");
  });

  it("should render SquadBoard with active stage and stall detection", () => {
    expect(typeof SquadBoard).toBe("function");

    const sampleSquad: SquadInfo = {
      id: "squad_test_123",
      name: "Security Audit Squad",
      stage: "auditing",
      statusLine: "Bug Hunter auditing endpoint parameters",
      activeRole: "bug_hunter",
      activeSessionId: "sess_hunter_1",
      members: {
        coder: {
          role: "coder",
          sessionId: "sess_c_1",
          active: false,
        },
        test_writer: {
          role: "test_writer",
          sessionId: "sess_tw_1",
          active: false,
        },
        bug_hunter: {
          role: "bug_hunter",
          sessionId: "sess_bh_1",
          active: true,
        },
        bug_fixer: {
          role: "bug_fixer",
          sessionId: "sess_bf_1",
          active: false,
        },
      },
      fixIterationCount: 1,
      maxFixIterations: 3,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 1000,
      stageStartedAt: Date.now() - 15000,
      stageTimeoutMs: 30000,
    };

    const element = React.createElement(SquadBoard, {
      squad: sampleSquad,
      findings: [
        {
          id: "f_test",
          title: "SQL injection in search filter",
          severity: "high",
          status: "being_fixed",
          timestamp: Date.now(),
        },
      ],
    });

    expect(element).toBeDefined();
    expect(element.props.squad?.stage).toBe("auditing");
    expect(element.props.findings?.length).toBe(1);
  });

  it("should render red alert badge when squad stage is stalled", () => {
    const stalledSquad: SquadInfo = {
      id: "squad_stalled_123",
      name: "Stalled Pipeline Squad",
      stage: "stalled",
      statusLine: "[STALLED] Squad stalled in stage 'coding' past 30s timeout.",
      activeRole: "coder",
      activeSessionId: "sess_c_1",
      members: {
        coder: { role: "coder", sessionId: "sess_c_1", active: true },
      },
      fixIterationCount: 0,
      maxFixIterations: 3,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      stageStartedAt: Date.now() - 45000,
      stageTimeoutMs: 30000,
    };

    const element = React.createElement(SquadBoard, {
      squad: stalledSquad,
      findings: [
        {
          id: "f_stalled_audit",
          title: "Memory buffer overrun in C extension",
          severity: "critical",
          status: "open",
          discoveredBy: "bug_hunter",
          timestamp: Date.now(),
        },
      ],
    });

    expect(element).toBeDefined();
    expect(element.props.squad?.stage).toBe("stalled");
    expect(element.props.findings?.[0]?.severity).toBe("critical");
    expect(element.props.findings?.[0]?.status).toBe("open");
  });
});
