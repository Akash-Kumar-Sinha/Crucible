import { SessionManager } from "../session/session-manager";
import { createHttpRouter } from "../http/server";
import { getBugHunterAuditLogger } from "../roles/bug-hunter-audit";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class BugHunterAuditTestProvider implements ModelProvider {
  readonly name = "bug_hunter_audit_test_provider";
  readonly defaultModel = "deepseek/deepseek-chat";
  private step = 0;

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    this.step += 1;

    if (this.step === 1) {
      return {
        thought: "Inspecting TLS certificate configuration using read_file",
        toolCalls: [
          {
            id: "call_read_tls",
            name: "read_file",
            arguments: { path: "src/security/tls.ts" },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    if (this.step === 2) {
      return {
        thought: "Calculating buffer size boundaries using calculator",
        toolCalls: [
          {
            id: "call_calc_buf",
            name: "calculator",
            arguments: { expression: "1024 * 1024" },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    return {
      thought: "Auditing complete. Summarizing findings.",
      content:
        "Audit Findings: Zero cryptographic weaknesses detected in TLS suite.",
      finishReason: "stop",
    };
  }
}

export async function runAuditLogViewerSyncVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "CRUCIBLE VERIFICATION: BUG HUNTER AUDIT LOG VIEWER & ON-DISK HASH CHAIN SYNC",
  );
  console.log(
    "================================================================================\n",
  );

  const auditLogger = getBugHunterAuditLogger();
  auditLogger.clear();

  const provider = new BugHunterAuditTestProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
  });

  const router = createHttpRouter(sessionManager);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: router,
  });

  console.log(
    `[Server] Orchestrator running on http://127.0.0.1:${server.port}`,
  );

  // 1. Run Bug Hunter session to generate audit entries
  const session = await sessionManager.createSession({
    title: "TLS Security Audit",
    role: "bug_hunter",
    model: "deepseek/deepseek-chat",
  });

  console.log(`[Bug Hunter Run] Session ID: ${session.id}`);
  console.log("  -> Prompting Bug Hunter for security probing...");
  const result = await session.prompt("Inspect TLS configuration");
  console.log(`  -> Execution finished with state: ${result.state}\n`);

  // 2. Query HTTP GET /audit/records from Browser / Client perspective
  console.log(
    "[HTTP Client] Fetching audit records from GET /audit/records...",
  );
  const res = await fetch(
    `http://127.0.0.1:${server.port}/audit/records?sessionId=${session.id}`,
  );
  if (!res.ok) {
    throw new Error(`HTTP GET /audit/records failed with status ${res.status}`);
  }

  const json = await res.json();
  const httpRecords = json.records || [];
  const httpIntegrity = json.integrity;

  console.log(
    `\n[Audit Log Viewer Response] Total Entries: ${httpRecords.length}`,
  );
  console.log(
    `[Cryptographic Chain Status]: ${httpIntegrity.valid ? "VALID (SEALED)" : "BROKEN"}\n`,
  );

  // 3. Match against underlying in-memory/on-disk audit logger records
  const localRecords = auditLogger.getAuditTrail(session.id);
  console.log(`[Underlying Audit Logger Records]: ${localRecords.length}`);

  if (httpRecords.length !== localRecords.length || httpRecords.length === 0) {
    throw new Error(
      `FAIL: Record count mismatch! HTTP got ${httpRecords.length}, Local got ${localRecords.length}`,
    );
  }

  console.log("\n--- DETAILED AUDIT TRAIL ENTRY COMPARISON ---");
  for (let i = 0; i < httpRecords.length; i++) {
    const hr = httpRecords[i];
    const lr = localRecords[i];

    console.log(`\n[Audit Entry #${hr.sequence}] Action: "${hr.action}"`);
    console.log(`  • ID Match:         ${hr.id === lr.id} (${hr.id})`);
    console.log(
      `  • Checksum Match:   ${hr.checksum === lr.checksum} (${hr.checksum.substring(0, 16)}...)`,
    );
    console.log(
      `  • Prev Hash Match:  ${hr.previousHash === lr.previousHash} (${hr.previousHash.substring(0, 16)}...)`,
    );
    console.log(
      `  • Sandboxed:        ${hr.sandboxed} (Air-Gapped: ${hr.networkBlocked})`,
    );

    if (
      hr.id !== lr.id ||
      hr.checksum !== lr.checksum ||
      hr.previousHash !== lr.previousHash
    ) {
      throw new Error(`FAIL: Field mismatch in audit entry #${hr.sequence}!`);
    }
  }

  // 4. Verify /audit/verify endpoint
  console.log("\n[HTTP Client] Querying GET /audit/verify...");
  const verifyRes = await fetch(`http://127.0.0.1:${server.port}/audit/verify`);
  const verifyJson = await verifyRes.json();
  console.log(
    `  -> Verify Result: valid=${verifyJson.integrity.valid}, totalRecords=${verifyJson.integrity.totalRecords}`,
  );

  if (!verifyJson.integrity.valid) {
    throw new Error("FAIL: /audit/verify reported invalid hash chain!");
  }

  console.log(
    "\n================================================================================",
  );
  console.log(
    "AUDIT LOG VIEWER & CRYPTOGRAPHIC HASH CHAIN MATCH VERIFIED (0 FAILURES)",
  );
  console.log(
    "================================================================================",
  );

  server.stop();
  sessionManager.clear();
  auditLogger.clear();
  process.exit(0);
}

if (import.meta.main) {
  runAuditLogViewerSyncVerification().catch((err) => {
    console.error("Audit log viewer sync verification failed:", err);
    process.exit(1);
  });
}
