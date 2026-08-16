import type { BugHunterAuditRecord } from "../../roles/bug-hunter-audit";
import { getBugHunterAuditLogger } from "../../roles/bug-hunter-audit";
import { getErrorReporter } from "../../observability/error-reporter";
import { logger } from "../../observability/logger";

/**
 * Repository pattern: Read-only REST route handler for the
 * Bug Hunter cryptographic audit trail and hash-chain verification.
 */
export class AuditRouteHandler {
  async handleGetRecords(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const sessionId = url.searchParams.get("sessionId") || undefined;
      const squadId = url.searchParams.get("squadId") || undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;

      const auditLogger = getBugHunterAuditLogger();
      let records: BugHunterAuditRecord[] = auditLogger.getAuditTrail(
        sessionId,
        limit,
      );

      if (squadId) {
        records = records.filter((r) => r.squadId === squadId);
      }

      const integrity = auditLogger.verifyIntegrity();

      return Response.json({
        status: "success",
        timestamp: new Date().toISOString(),
        records,
        total: records.length,
        integrity,
      });
    } catch (err: any) {
      logger.error(
        { err },
        "[AuditRouteHandler] Failed to retrieve Bug Hunter audit trail",
      );

      getErrorReporter().captureAgentError(
        err instanceof Error ? err : new Error(String(err)),
        {
          component: "AuditRouteHandler",
          alert: "CRUCIBLE_AUDIT_LOG_READ_FAILURE_ALERT",
          action: "read_audit_records",
          reason: "High severity failure reading Bug Hunter audit log",
        },
      );

      return Response.json(
        {
          status: "error",
          error: {
            code: "AUDIT_READ_FAILURE",
            message: "Failed to read cryptographic audit records",
            details: err?.message,
          },
        },
        { status: 500 },
      );
    }
  }

  async handleVerifyIntegrity(): Promise<Response> {
    try {
      const auditLogger = getBugHunterAuditLogger();
      const integrity = auditLogger.verifyIntegrity();

      return Response.json({
        status: "success",
        timestamp: new Date().toISOString(),
        integrity,
      });
    } catch (err: any) {
      logger.error(
        { err },
        "[AuditRouteHandler] Failed to verify audit trail cryptographic integrity",
      );

      getErrorReporter().captureAgentError(
        err instanceof Error ? err : new Error(String(err)),
        {
          component: "AuditRouteHandler",
          alert: "CRUCIBLE_AUDIT_LOG_READ_FAILURE_ALERT",
          action: "verify_audit_integrity",
          reason: "High severity failure verifying audit log hash chain",
        },
      );

      return Response.json(
        {
          status: "error",
          error: {
            code: "AUDIT_VERIFY_FAILURE",
            message: "Failed to verify audit hash chain integrity",
            details: err?.message,
          },
        },
        { status: 500 },
      );
    }
  }
}
