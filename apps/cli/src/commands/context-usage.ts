import { CrucibleClient } from "@crucible/sdk";
import {
  badge,
  c,
  formatProgressBar,
  formatTable,
  printBanner,
} from "../formatters";

export interface ContextUsageCommandOptions {
  endpoint?: string;
  tenantId?: string;
  namespace?: string;
  json?: boolean;
}

export async function runContextUsageCommand(
  sessionId: string,
  options: ContextUsageCommandOptions = {},
): Promise<number> {
  if (!sessionId) {
    console.error(`\n${badge("ERROR", "fail")} Session ID is required.`);
    console.error(`Usage: $ crucible context-usage <session-id>\n`);
    return 1;
  }

  const client = new CrucibleClient({
    endpoint: options.endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  try {
    const [usage, session] = await Promise.all([
      client.sessions.getContextUsage(sessionId),
      client.sessions.get(sessionId).catch(() => null),
    ]);

    if (options.json) {
      console.log(JSON.stringify({ usage, session }, null, 2));
      return 0;
    }

    printBanner(
      "CONTEXT WINDOW & TOKEN UTILIZATION",
      `Session ID: ${sessionId}`,
    );

    const rows = [
      [`${c.bold}Session ID${c.reset}`, `${c.cyan}${sessionId}${c.reset}`],
      [`${c.bold}Title${c.reset}`, session?.title || "Autonomous Session"],
      [
        `${c.bold}Role${c.reset}`,
        session?.role
          ? `${c.magenta}${session.role}${c.reset}`
          : `${c.dim}default${c.reset}`,
      ],
      [
        `${c.bold}Model${c.reset}`,
        session?.model
          ? `${c.yellow}${session.model}${c.reset}`
          : `${c.dim}auto${c.reset}`,
      ],
      [
        `${c.bold}Token Usage${c.reset}`,
        `${usage.totalTokens.toLocaleString()} / ${usage.limit.toLocaleString()} tokens`,
      ],
      [
        `${c.bold}Utilization Bar${c.reset}`,
        formatProgressBar(usage.usagePercent),
      ],
      [
        `${c.bold}Compaction Strategy${c.reset}`,
        `${c.bold}${usage.strategyName || "hybrid"}${c.reset}`,
      ],
      [
        `${c.bold}Compaction State${c.reset}`,
        usage.isSummarized
          ? `${c.green}${c.bold}[COMPACTED]${c.reset} (${usage.summarizedTurnCount} turns summarized)`
          : `${c.dim}[RAW / EXPANDED]${c.reset}`,
      ],
      [
        `${c.bold}Total Messages${c.reset}`,
        String(session?.messages?.length ?? 0),
      ],
    ];

    console.log(formatTable(["Metric", "Value"], rows));

    if (usage.runningSummary) {
      console.log(`\n${c.bold}Running Memento Summary:${c.reset}`);
      console.log(
        `${c.dim}────────────────────────────────────────────────────────────────${c.reset}`,
      );
      console.log(usage.runningSummary);
      console.log(
        `${c.dim}────────────────────────────────────────────────────────────────${c.reset}`,
      );
    }

    console.log();
    return 0;
  } catch (err: any) {
    console.error(
      `\n${badge("ERROR", "fail")} Failed to fetch context usage: ${err.message}\n`,
    );
    return 1;
  }
}
