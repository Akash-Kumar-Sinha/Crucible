import { CrucibleClient } from "@crucible/sdk";
import { c, formatTable, printBanner } from "../formatters";

export interface SandboxLogsCommandOptions {
  sessionId?: string;
  endpoint?: string;
  json?: boolean;
  turns?: boolean;
}

export async function runSandboxLogsCommand(
  sessionId?: string,
  options: SandboxLogsCommandOptions = {},
): Promise<number> {
  const endpoint =
    options.endpoint ||
    process.env.CRUCIBLE_ENDPOINT ||
    (process.env.PORT
      ? `http://localhost:${process.env.PORT}`
      : "http://localhost:4000");

  const client = new CrucibleClient({ endpoint });

  if (!sessionId) {
    // List available sessions so developer can pick one
    try {
      const sessions = await client.sessions.list();
      if (sessions.length === 0) {
        console.log(
          `${c.yellow}No active agent sessions found on ${endpoint}.${c.reset}\n`,
        );
        return 0;
      }

      printBanner(
        "Active Crucible Sessions",
        "Specify a session ID to view sandbox isolation logs",
      );
      const headers = ["Session ID", "Title", "Role", "Status", "Turns"];
      const rows = sessions.map((s) => [
        `${c.cyan}${s.id}${c.reset}`,
        s.title || "Untitled",
        s.role || "general",
        s.status,
        String(s.turnCount || 0),
      ]);
      console.log(formatTable(headers, rows));
      console.log(
        `\nUsage: ${c.bold}crucible sandbox-logs <sessionId>${c.reset}\n`,
      );
      return 0;
    } catch (err: any) {
      console.error(
        `${c.red}Failed to query sessions:${c.reset} ${err.message || err}`,
      );
      return 1;
    }
  }

  if (!options.json) {
    printBanner(
      "Crucible Sandbox Diagnostics & Telemetry",
      `Session: ${sessionId}`,
    );
  }

  let sessionDetail: any;
  let sandboxInfo: any;
  let infraStatus: any;

  try {
    [sessionDetail, sandboxInfo, infraStatus] = await Promise.all([
      client.sessions.get(sessionId),
      client.sessions.getSandboxInfo(sessionId).catch(() => ({})),
      client.sessions.getInfraStatus(sessionId).catch(() => ({})),
    ]);
  } catch (err: any) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { status: "error", error: err.message || String(err) },
          null,
          2,
        ),
      );
      return 1;
    }
    console.error(
      `${c.red}Failed to retrieve session logs:${c.reset} ${err.message || err}`,
    );
    return 1;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          session: sessionDetail,
          sandbox: sandboxInfo,
          infra: infraStatus,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`${c.bold}Session Overview:${c.reset}`);
  console.log(`  • ID:        ${c.cyan}${sessionDetail.id}${c.reset}`);
  console.log(`  • Title:     ${sessionDetail.title || "Untitled"}`);
  console.log(`  • Status:    ${sessionDetail.status}`);
  console.log(`  • Role:      ${sessionDetail.role || "general"}`);
  console.log(`  • Model:     ${sessionDetail.model || "default"}`);
  if (sessionDetail.tenantId) {
    console.log(`  • Tenant:    ${sessionDetail.tenantId}`);
  }
  if (sessionDetail.namespace) {
    console.log(`  • Namespace: ${sessionDetail.namespace}`);
  }
  console.log("");

  if (sandboxInfo && Object.keys(sandboxInfo).length > 0) {
    console.log(`${c.bold}Compute Isolation & Security Profiles:${c.reset}`);
    if (sandboxInfo.cgroups) {
      console.log(
        `  • cgroups v2 Limits: CPU Max: ${sandboxInfo.cgroups.cpuMax || "unrestricted"} | Memory Max: ${sandboxInfo.cgroups.memoryMax || "unrestricted"} | PIDs: ${sandboxInfo.cgroups.pidsMax || "unrestricted"}`,
      );
    }
    if (sandboxInfo.overlayfs) {
      console.log(
        `  • OverlayFS Mount:   Merged: ${sandboxInfo.overlayfs.mergedDir || "default"} | Upper: ${sandboxInfo.overlayfs.upperDir || "ephemeral"}`,
      );
    }
    if (sandboxInfo.network) {
      console.log(
        `  • Network Policy:   Airgap: ${sandboxInfo.network.airgap ? `${c.green}Enforced${c.reset}` : "Standard"} | Policy: ${sandboxInfo.network.policy || "allow_outbound"}`,
      );
    }
    console.log("");
  }

  const messages = sessionDetail.messages || [];
  console.log(
    `${c.bold}Execution History (${messages.length} messages):${c.reset}`,
  );

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleColor =
      msg.role === "user"
        ? c.blue
        : msg.role === "assistant"
          ? c.green
          : msg.role === "tool"
            ? c.magenta
            : c.white;

    console.log(
      `\n  ${roleColor}${c.bold}[${msg.role.toUpperCase()}]${c.reset}`,
    );
    if (msg.thought) {
      console.log(
        `  ${c.dim}${c.yellow}Thought: ${msg.thought.slice(0, 300)}${msg.thought.length > 300 ? "..." : ""}${c.reset}`,
      );
    }
    if (msg.content) {
      console.log(`  ${msg.content}`);
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        console.log(
          `  ${c.magenta}Tool Call: ${tc.name}${c.reset} ${c.dim}${JSON.stringify(tc.arguments || {})}${c.reset}`,
        );
      }
    }
  }

  console.log("\n");
  return 0;
}
