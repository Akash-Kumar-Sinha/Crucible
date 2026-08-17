import { CrucibleClient } from "@crucible/sdk";
import { badge, c, formatTable, printBanner } from "../formatters";

export interface AuditTailCommandOptions {
  endpoint?: string;
  limit?: number;
  verify?: boolean;
  tenantId?: string;
  namespace?: string;
  json?: boolean;
}

export async function runAuditTailCommand(
  sessionId?: string,
  options: AuditTailCommandOptions = {},
): Promise<number> {
  const client = new CrucibleClient({
    endpoint: options.endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  try {
    if (options.verify) {
      const integrity = await client.audit.verifyIntegrity();

      if (options.json) {
        console.log(JSON.stringify(integrity, null, 2));
        return integrity.valid ? 0 : 1;
      }

      printBanner(
        "CRYPTOGRAPHIC AUDIT TRAIL VERIFICATION",
        "Tamper-Evident SHA-256 Hash Chain Integrity Probe",
      );

      console.log(
        `  ${c.bold}Integrity Status:${c.reset}  ${integrity.valid ? `${c.green}${c.bold}[VALID / SEALED]${c.reset}` : `${c.red}${c.bold}[TAMPERED / CORRUPTED]${c.reset}`}`,
      );
      console.log(
        `  ${c.bold}Total Records:${c.reset}     ${integrity.totalRecords}`,
      );

      if (!integrity.valid && integrity.brokenSequence !== undefined) {
        console.log(
          `  ${c.bold}Broken Sequence:${c.reset}   ${c.red}#${integrity.brokenSequence}${c.reset}`,
        );
      }

      console.log();
      return integrity.valid ? 0 : 1;
    }

    const records = await client.audit.getRecords({
      sessionId,
      limit: options.limit || 20,
    });

    if (options.json) {
      console.log(JSON.stringify(records, null, 2));
      return 0;
    }

    printBanner(
      "BUG HUNTER CRYPTOGRAPHIC AUDIT LOG",
      sessionId
        ? `Filtered by Session: ${sessionId}`
        : "Cluster-Wide Audit Stream",
    );

    if (records.length === 0) {
      console.log(`  ${c.dim}No audit records found.${c.reset}\n`);
      return 0;
    }

    const headers = [
      "Seq",
      "Time",
      "Action",
      "Role",
      "Air-Gap",
      "Sandbox",
      "SHA-256 Hash",
    ];
    const rows = records.map((r) => {
      const timeStr = new Date(r.timestamp).toLocaleTimeString();
      const airgapBadge = r.networkBlocked
        ? `${c.green}airgapped${c.reset}`
        : `${c.yellow}standard${c.reset}`;
      const sandboxBadge = r.sandboxed
        ? `${c.green}isolated${c.reset}`
        : `${c.dim}host${c.reset}`;
      const hashShort = r.checksum
        ? `${r.checksum.slice(0, 10)}...`
        : `${c.dim}-${c.reset}`;

      return [
        `#${r.sequence}`,
        timeStr,
        `${c.bold}${r.action}${c.reset}`,
        `${c.magenta}${r.role || "bug_hunter"}${c.reset}`,
        airgapBadge,
        sandboxBadge,
        `${c.cyan}${hashShort}${c.reset}`,
      ];
    });

    console.log(formatTable(headers, rows));
    console.log(
      `\n  Showing ${c.bold}${records.length}${c.reset} audit events. (Run with ${c.bold}--verify${c.reset} to validate hash chain integrity)\n`,
    );

    return 0;
  } catch (err: any) {
    console.error(
      `\n${badge("ERROR", "fail")} Failed to retrieve audit trail: ${err.message}\n`,
    );
    return 1;
  }
}
