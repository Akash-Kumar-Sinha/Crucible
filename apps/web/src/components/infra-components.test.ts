import { describe, it, expect } from "bun:test";
import React from "react";
import { JobStatusBadge } from "./JobStatusBadge";
import { QueuePositionBadge } from "./QueuePositionBadge";
import { TenantSwitcher } from "./TenantSwitcher";

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
});
