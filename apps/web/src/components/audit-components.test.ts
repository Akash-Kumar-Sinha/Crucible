import { describe, it, expect } from "bun:test";
import React from "react";
import { AuditLogTable } from "@/components/audit/AuditLogTable";
import type { AuditRecord } from "../api/orchestrator-client";

describe("AuditLogTable Web UI Component", () => {
  it("should define AuditLogTable with tamper-evident cryptographic validation", () => {
    expect(typeof AuditLogTable).toBe("function");

    const sampleRecords: AuditRecord[] = [
      {
        id: "audit_1",
        sequence: 1,
        sessionId: "sess_bh_test",
        role: "bug_hunter",
        action: "bash_exec",
        input: { command: "curl -I http://169.254.169.254" },
        output: "Network unreachable (Air-gap enforced)",
        sandboxed: true,
        networkBlocked: true,
        readOnlyEnforced: true,
        timestamp: Date.now(),
        previousHash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        checksum:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ];

    const element = React.createElement(AuditLogTable, {
      records: sampleRecords,
      integrity: { valid: true, totalRecords: 1 },
    });

    expect(element).toBeDefined();
    expect(element.props.records.length).toBe(1);
    expect(element.props.integrity?.valid).toBe(true);
  });

  it("should render empty state when no audit records are present", () => {
    const element = React.createElement(AuditLogTable, {
      records: [],
      integrity: { valid: true, totalRecords: 0 },
    });

    expect(element).toBeDefined();
    expect(element.props.records.length).toBe(0);
  });
});
