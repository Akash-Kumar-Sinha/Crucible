import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";

export interface BugHunterAuditRecord {
  id: string;
  sequence: number;
  sessionId: string;
  squadId?: string;
  role: "bug_hunter";
  action: string;
  input: Record<string, unknown> | string;
  output?: string;
  error?: string;
  sandboxed: boolean;
  networkBlocked: boolean;
  readOnlyEnforced: boolean;
  timestamp: number;
  previousHash: string;
  checksum: string;
}

export interface RecordAuditParams {
  sessionId: string;
  squadId?: string;
  action: string;
  input: Record<string, unknown> | string;
  output?: string;
  error?: string;
  tenantId?: string;
  namespace?: string;
}

/**
 * Append-only Log / Event Sourcing pattern:
 * Tamper-evident, cryptographically chained audit trail specifically
 * for the adversarial Bug Hunter security auditing role.
 */
export class BugHunterAuditLogger extends EventEmitter {
  private records: BugHunterAuditRecord[] = [];
  private latestHash =
    "0000000000000000000000000000000000000000000000000000000000000000";
  private sequenceCounter = 0;

  /**
   * Append a new audit record to the cryptographic hash chain
   */
  recordAction(params: RecordAuditParams): BugHunterAuditRecord {
    this.sequenceCounter += 1;
    const timestamp = Date.now();
    const id = `audit_bh_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;

    const serializedInput =
      typeof params.input === "string"
        ? params.input
        : JSON.stringify(params.input);

    const payloadToHash = `${this.sequenceCounter}:${params.sessionId}:${params.action}:${serializedInput}:${params.output || ""}:${params.error || ""}:${timestamp}:${this.latestHash}`;

    const checksum = createHash("sha256").update(payloadToHash).digest("hex");

    const record: BugHunterAuditRecord = {
      id,
      sequence: this.sequenceCounter,
      sessionId: params.sessionId,
      squadId: params.squadId,
      role: "bug_hunter",
      action: params.action,
      input: params.input,
      output: params.output,
      error: params.error,
      sandboxed: true,
      networkBlocked: true,
      readOnlyEnforced: true,
      timestamp,
      previousHash: this.latestHash,
      checksum,
    };

    this.latestHash = checksum;
    this.records.push(record);

    logger.info(
      {
        auditId: id,
        sequence: this.sequenceCounter,
        sessionId: params.sessionId,
        action: params.action,
        checksum,
      },
      `[Bug Hunter Audit Log] Action '${params.action}' sealed with hash ${checksum.substring(0, 12)}...`,
    );

    this.emit("auditRecorded", record);
    return record;
  }

  /**
   * Cryptographic integrity verification across the entire audit trail
   */
  verifyIntegrity(): {
    valid: boolean;
    totalRecords: number;
    brokenSequence?: number;
  } {
    let expectedPreviousHash =
      "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];

      if (rec.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          totalRecords: this.records.length,
          brokenSequence: rec.sequence,
        };
      }

      const serializedInput =
        typeof rec.input === "string" ? rec.input : JSON.stringify(rec.input);

      const payloadToHash = `${rec.sequence}:${rec.sessionId}:${rec.action}:${serializedInput}:${rec.output || ""}:${rec.error || ""}:${rec.timestamp}:${rec.previousHash}`;

      const computedChecksum = createHash("sha256")
        .update(payloadToHash)
        .digest("hex");

      if (computedChecksum !== rec.checksum) {
        return {
          valid: false,
          totalRecords: this.records.length,
          brokenSequence: rec.sequence,
        };
      }

      expectedPreviousHash = rec.checksum;
    }

    return {
      valid: true,
      totalRecords: this.records.length,
    };
  }

  /**
   * Health check / Observability:
   * Alert if a bug hunter session performed an execution without being logged
   */
  assertActionAudited(
    sessionId: string,
    action: string,
    tenantId?: string,
    namespace?: string,
  ): boolean {
    const hasRecord = this.records.some(
      (r) => r.sessionId === sessionId && r.action === action,
    );

    if (!hasRecord) {
      getErrorReporter().captureAgentError(
        new Error(
          `CRITICAL: Bug Hunter action '${action}' was executed in session '${sessionId}' without a corresponding cryptographic audit trail entry!`,
        ),
        {
          sessionId,
          role: "bug_hunter",
          alert: "CRUCIBLE_BUG_HUNTER_AUDIT_MISSING_ALERT",
          action: "audit_trail_gap_detected",
          tenantId,
          namespace,
        },
      );
      return false;
    }

    return true;
  }

  getAuditTrail(sessionId?: string, limit = 100): BugHunterAuditRecord[] {
    let result = this.records;
    if (sessionId) {
      result = result.filter((r) => r.sessionId === sessionId);
    }
    return result.slice(-limit);
  }

  clear(): void {
    this.records = [];
    this.latestHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    this.sequenceCounter = 0;
  }
}

let defaultAuditLogger: BugHunterAuditLogger | null = null;

export function getBugHunterAuditLogger(): BugHunterAuditLogger {
  if (!defaultAuditLogger) {
    defaultAuditLogger = new BugHunterAuditLogger();
  }
  return defaultAuditLogger;
}

export function resetBugHunterAuditLogger(): void {
  if (defaultAuditLogger) {
    defaultAuditLogger.clear();
    defaultAuditLogger = null;
  }
}
