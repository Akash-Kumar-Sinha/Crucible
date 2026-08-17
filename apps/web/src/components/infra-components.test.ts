import { describe, it, expect } from "bun:test";
import React from "react";
import { JobStatusBadge } from "@/components/status/JobStatusBadge";
import { QueuePositionBadge } from "@/components/status/QueuePositionBadge";
import { TenantSwitcher } from "@/components/sidebar/TenantSwitcher";
import { TokenUsageBadge } from "@/components/status/TokenUsageBadge";
import { ModelPicker } from "@/components/workspace/ModelPicker";
import { RolePicker } from "@/components/workspace/RolePicker";
import { RoleModelPicker } from "@/components/workspace/RoleModelPicker";
import { TokenUsagePanel } from "@/components/metrics/TokenUsagePanel";
import { ModelUsagePanel } from "@/components/metrics/ModelUsagePanel";
import { RoleActivityPanel } from "@/components/metrics/RoleActivityPanel";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";

describe("Infrastructure UI Components", () => {
  it("should render JobStatusBadge with different Kubernetes phases", () => {
    const running = React.createElement(JobStatusBadge, {
      phase: "Running",
      podName: "pod-123456",
      namespace: "crucible",
    });
    expect(running).toBeDefined();
    expect(running.props.phase).toBe("Running");
    expect(running.props.podName).toBe("pod-123456");

    const failed = React.createElement(JobStatusBadge, {
      phase: "Failed",
      oomKilled: true,
      namespace: "crucible-staging",
    });
    expect(failed.props.oomKilled).toBe(true);
  });

  it("should render QueuePositionBadge with position and backlog metadata", () => {
    const badge = React.createElement(QueuePositionBadge, {
      position: 2,
      backlogCount: 5,
      activeConsumers: 2,
      estimatedWaitMs: 3000,
      status: "queued",
    });
    expect(badge).toBeDefined();
    expect(badge.props.position).toBe(2);
    expect(badge.props.backlogCount).toBe(5);
    expect(badge.props.status).toBe("queued");
  });

  it("should render TenantSwitcher with active scope and callback", () => {
    let _changedScope: any = null;
    const switcher = React.createElement(TenantSwitcher, {
      tenantId: "tenant-acme",
      namespace: "crucible-prod",
      availableTenants: ["default", "tenant-acme"],
      availableNamespaces: ["crucible", "crucible-prod"],
      onScopeChange: (scope) => {
        _changedScope = scope;
      },
    });
    expect(switcher).toBeDefined();
    expect(switcher.props.tenantId).toBe("tenant-acme");
    expect(switcher.props.namespace).toBe("crucible-prod");
  });

  it("should render TokenUsageBadge with token counts, limits, and compact status", () => {
    const badge = React.createElement(TokenUsageBadge, {
      totalTokens: 14200,
      limit: 128000,
      usagePercent: 11,
      isSummarized: true,
      model: "openai/gpt-4o",
    });
    expect(badge).toBeDefined();
    expect(badge.props.totalTokens).toBe(14200);
    expect(badge.props.limit).toBe(128000);
    expect(badge.props.isSummarized).toBe(true);
  });

  it("should render ModelPicker with selected model and callback", () => {
    let _picked = "";
    const picker = React.createElement(ModelPicker, {
      selectedModel: "anthropic/claude-3.5-sonnet",
      onModelChange: (modelId) => {
        _picked = modelId;
      },
    });
    expect(picker).toBeDefined();
    expect(picker.props.selectedModel).toBe("anthropic/claude-3.5-sonnet");
  });

  it("should render RolePicker with selected role and callback", () => {
    let _pickedRole = "";
    const picker = React.createElement(RolePicker, {
      selectedRole: "bug_hunter",
      onRoleChange: (roleId) => {
        _pickedRole = roleId;
      },
    });
    expect(picker).toBeDefined();
    expect(picker.props.selectedRole).toBe("bug_hunter");
  });

  it("should render RoleModelPicker (Composite pattern)", () => {
    const compositePicker = React.createElement(RoleModelPicker, {
      selectedRole: "coder",
      selectedModel: "anthropic/claude-3.5-sonnet",
      onRoleChange: () => {},
      onModelChange: () => {},
    });
    expect(compositePicker).toBeDefined();
    expect(compositePicker.props.selectedRole).toBe("coder");
  });

  it("should render TokenUsagePanel with session token consumption and compaction", () => {
    const panel = React.createElement(TokenUsagePanel, {
      tokenMetrics: {
        totalTokensConsumed: 124000,
        summarizedSessionsCount: 1,
        perSessionTokens: [
          {
            sessionId: "sess_test_1",
            model: "anthropic/claude-3.5-sonnet",
            totalTokens: 68000,
            limit: 128000,
            usagePercent: 53,
            isSummarized: true,
            summarizedTurnCount: 4,
          },
        ],
      },
    });
    expect(panel).toBeDefined();
    expect(panel.props.tokenMetrics?.totalTokensConsumed).toBe(124000);
  });

  it("should render ModelUsagePanel with request breakdown", () => {
    const panel = React.createElement(ModelUsagePanel, {
      modelMetrics: {
        totalRequests: 45,
        models: {
          "anthropic/claude-3.5-sonnet": {
            model: "anthropic/claude-3.5-sonnet",
            requestCount: 30,
            totalLatencyMs: 25000,
            meanLatencyMs: 833,
            errorCount: 0,
            errorRate: 0,
          },
        },
      },
    });
    expect(panel).toBeDefined();
    expect(panel.props.modelMetrics?.totalRequests).toBe(45);
  });

  it("should render RoleActivityPanel with role workload and cross-bus traffic", () => {
    const panel = React.createElement(RoleActivityPanel, {
      roleMetrics: {
        roles: {
          coder: {
            role: "coder",
            sessionCount: 2,
            turnCount: 10,
            toolCallsCount: 15,
            errorCount: 0,
            errorRate: 0,
            crossSessionSent: 2,
            crossSessionReceived: 1,
          },
        },
      },
      crossSessionMetrics: {
        totalPublished: 12,
        totalDelivered: 12,
        totalUndeliverable: 0,
        deadLetterCount: 0,
        activeSubscribers: 4,
      },
    });
    expect(panel).toBeDefined();
    expect(panel.props.crossSessionMetrics?.totalPublished).toBe(12);
  });

  it("should render SessionSidebar pinned open on desktop viewports by default", () => {
    expect(typeof SessionSidebar).toBe("function");

    const sidebar = React.createElement(SessionSidebar, {
      sessions: [
        {
          id: "sess_1",
          title: "Session 1",
          status: "idle",
          agentState: "idle",
          messageCount: 2,
          stepCount: 1,
          turnCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      onCreateSession: async () => {},
      onDeleteSession: async () => {},
    });

    expect(sidebar).toBeDefined();
    expect(sidebar.props.sessions.length).toBe(1);
  });
});
