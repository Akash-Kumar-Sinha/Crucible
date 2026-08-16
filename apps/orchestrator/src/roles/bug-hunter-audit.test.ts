import { describe, it, expect, beforeEach } from "bun:test";
import {
  BugHunterAuditLogger,
  resetBugHunterAuditLogger,
} from "./bug-hunter-audit";
import { getErrorReporter } from "../observability/error-reporter";
import { SessionManager } from "../session/session-manager";

describe("Adversarial Sandbox Hardening & Bug Hunter Audit Trail", () => {
  let auditLogger: BugHunterAuditLogger;

  beforeEach(() => {
    resetBugHunterAuditLogger();
    getErrorReporter().resetMetrics();
    auditLogger = new BugHunterAuditLogger();
  });

  it("should record append-only actions into a cryptographic hash chain", () => {
    const record1 = auditLogger.recordAction({
      sessionId: "sess_bh_1",
      action: "bash_exec",
      input: { command: "curl -v http://internal.corp:8080/admin" },
      output: "Connection refused (Network air-gap active)",
    });

    expect(record1.sequence).toBe(1);
    expect(record1.sandboxed).toBe(true);
    expect(record1.networkBlocked).toBe(true);
    expect(record1.readOnlyEnforced).toBe(true);
    expect(record1.checksum.length).toBe(64); // SHA-256
    expect(record1.previousHash).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );

    const record2 = auditLogger.recordAction({
      sessionId: "sess_bh_1",
      action: "read_file",
      input: { path: "/etc/shadow" },
      error:
        "Permission denied (Restricted profile seccomp / read-only sandbox)",
    });

    expect(record2.sequence).toBe(2);
    expect(record2.previousHash).toBe(record1.checksum);

    const integrity = auditLogger.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalRecords).toBe(2);
  });

  it("should detect tampering if an historical audit entry is modified", () => {
    auditLogger.recordAction({
      sessionId: "sess_bh_2",
      action: "probe_jwt_timing",
      input: { payload: "attack_payload_1" },
    });

    auditLogger.recordAction({
      sessionId: "sess_bh_2",
      action: "probe_jwt_timing",
      input: { payload: "attack_payload_2" },
    });

    const trail = auditLogger.getAuditTrail("sess_bh_2");
    expect(trail.length).toBe(2);

    // Tamper with record 1 payload
    (trail[0] as any).input = "tampered_payload";

    const integrity = auditLogger.verifyIntegrity();
    expect(integrity.valid).toBe(false);
    expect(integrity.brokenSequence).toBe(1);
  });

  it("should trigger critical alert on audit trail gaps for bug hunter actions", () => {
    let alertEmitted = false;
    const errorReporter = getErrorReporter();
    errorReporter.on("errorCaptured", (rec) => {
      if (rec.context?.alert === "CRUCIBLE_BUG_HUNTER_AUDIT_MISSING_ALERT") {
        alertEmitted = true;
      }
    });

    // Session has no recorded action for "port_scan"
    const audited = auditLogger.assertActionAudited(
      "sess_bh_gap",
      "port_scan",
      "tenant_alpha",
      "crucible",
    );

    expect(audited).toBe(false);
    expect(alertEmitted).toBe(true);
  });

  it("should automatically record actions and observations when SessionManager runs bug hunter session", async () => {
    const sessionManager = new SessionManager({
      autoPersist: false,
    });

    const session = sessionManager.createSession({
      role: "bug_hunter",
      metadata: { squadId: "squad_test_audit" },
    });

    // Simulate tool action and observation events
    session.emit("action", [
      {
        id: "call_1",
        name: "bash_exec",
        arguments: { command: "id" },
      },
    ]);

    session.emit("observation", [
      {
        callId: "call_1",
        name: "bash_exec",
        output: "uid=10001(sandbox) gid=10001(sandbox)",
      },
    ]);

    const { getBugHunterAuditLogger } = await import("./bug-hunter-audit");
    const records = getBugHunterAuditLogger().getAuditTrail(session.id);
    expect(records.length).toBe(2);
    expect(records[0].action).toBe("bash_exec");
    expect(records[1].action).toBe("bash_exec:observation");
    expect(records[0].squadId).toBe("squad_test_audit");
  });
});
