import { CrucibleClient } from "@crucible/sdk";
import { badge, c, printBanner } from "../formatters";

export interface SessionSendCommandOptions {
  endpoint?: string;
  priority?: "critical" | "high" | "normal" | "low";
  async?: boolean;
  tenantId?: string;
  namespace?: string;
  json?: boolean;
}

export async function runSessionSendCommand(
  sessionId: string,
  message: string,
  options: SessionSendCommandOptions = {},
): Promise<number> {
  if (!sessionId) {
    console.error(`\n${badge("ERROR", "fail")} Source Session ID is required.`);
    console.error(`Usage: $ crucible session-send <session-id> "message"\n`);
    return 1;
  }

  if (!message || message.trim().length === 0) {
    console.error(
      `\n${badge("ERROR", "fail")} Message body cannot be empty.\n`,
    );
    return 1;
  }

  const client = new CrucibleClient({
    endpoint: options.endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  try {
    // Direct session prompt
    const response = await client.sessions.prompt(sessionId, message, {
      async: options.async,
      priority: options.priority,
    });

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return 0;
    }

    if (options.async) {
      printBanner(
        "JOB QUEUED (ASYNC)",
        `Submitted to competing consumer worker pool`,
      );
      console.log(
        `  ${c.bold}Session ID:${c.reset}  ${c.cyan}${response.sessionId}${c.reset}`,
      );
      console.log(
        `  ${c.bold}Job ID:${c.reset}      ${c.yellow}${response.jobId || "pending"}${c.reset}`,
      );
      console.log(
        `  ${c.bold}Priority:${c.reset}    ${options.priority || "normal"}`,
      );
      console.log(
        `  ${c.bold}Status:${c.reset}      ${badge(response.status, "ok")}\n`,
      );
      return 0;
    }

    console.log(`\n${c.bold}${c.green}Crucible Agent Response:${c.reset}`);
    console.log(`${response.response || "(No textual output generated)"}\n`);

    return 0;
  } catch (err: any) {
    console.error(
      `\n${badge("ERROR", "fail")} Message dispatch failed: ${err.message}\n`,
    );
    return 1;
  }
}
