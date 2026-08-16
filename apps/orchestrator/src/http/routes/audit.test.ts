import { describe, it, expect, beforeEach } from "bun:test";
import { AuditRouteHandler } from "./audit";
import {
  getBugHunterAuditLogger,
  resetBugHunterAuditLogger,
} from "../../roles/bug-hunter-audit";

describe("AuditRouteHandler (REST API)", () => {
  let handler: AuditRouteHandler;

  beforeEach(() => {
    resetBugHunterAuditLogger();
    handler = new AuditRouteHandler();
  });

  it("should return empty audit records list when no bug hunter actions occurred", async () => {
    const req = new Request("http://localhost:4000/audit/records");
    const res = await handler.handleGetRecords(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.records).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.integrity.valid).toBe(true);
  });

  it("should return recorded audit trail entries with cryptographic verification", async () => {
    const auditLogger = getBugHunterAuditLogger();
    auditLogger.recordAction({
      sessionId: "sess_hunter_42",
      squadId: "squad_sec_1",
      action: "bash_exec",
      input: { command: "nmap -sS localhost" },
      output: "Operation not permitted (air-gapped network policy)",
    });

    const req = new Request(
      "http://localhost:4000/audit/records?sessionId=sess_hunter_42",
    );
    const res = await handler.handleGetRecords(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.records.length).toBe(1);
    expect(json.records[0].action).toBe("bash_exec");
    expect(json.records[0].sandboxed).toBe(true);
    expect(json.integrity.valid).toBe(true);
  });

  it("should verify cryptographic integrity via /audit/verify", async () => {
    const auditLogger = getBugHunterAuditLogger();
    auditLogger.recordAction({
      sessionId: "sess_hunter_99",
      action: "probe_sql_injection",
      input: { payload: "1' OR '1'='1" },
    });

    const res = await handler.handleVerifyIntegrity();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.integrity.valid).toBe(true);
    expect(json.integrity.totalRecords).toBe(1);
  });
});
