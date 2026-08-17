import { CrucibleClient } from "@crucible/sdk";
import { badge, c, formatTable, printBanner } from "../formatters";

export interface SessionCreateCommandOptions {
  endpoint?: string;
  title?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  systemPrompt?: string;
  json?: boolean;
}

export async function runSessionCreateCommand(
  options: SessionCreateCommandOptions = {},
): Promise<number> {
  const client = new CrucibleClient({
    endpoint: options.endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  try {
    const session = await client.sessions.create({
      title: options.title || "CLI Autonomous Session",
      role: options.role,
      model: options.model,
      tenantId: options.tenantId,
      namespace: options.namespace,
      systemPrompt: options.systemPrompt,
    });

    if (options.json) {
      console.log(JSON.stringify(session, null, 2));
      return 0;
    }

    printBanner(
      "SESSION INITIALIZED",
      "Crucible Autonomous Agent Execution Context",
    );

    const rows = [
      [`${c.bold}Session ID${c.reset}`, `${c.cyan}${session.id}${c.reset}`],
      [`${c.bold}Title${c.reset}`, session.title || "Autonomous Session"],
      [
        `${c.bold}Agent Role${c.reset}`,
        session.role
          ? `${c.magenta}${session.role}${c.reset}`
          : `${c.dim}default (full access)${c.reset}`,
      ],
      [
        `${c.bold}Model Strategy${c.reset}`,
        session.model
          ? `${c.yellow}${session.model}${c.reset}`
          : `${c.dim}auto / openrouter${c.reset}`,
      ],
      [`${c.bold}Status${c.reset}`, badge(session.status || "idle", "ok")],
    ];

    if (session.tenantId) {
      rows.push([`${c.bold}Tenant Scope${c.reset}`, session.tenantId]);
    }
    if (session.namespace) {
      rows.push([`${c.bold}K8s Namespace${c.reset}`, session.namespace]);
    }

    console.log(formatTable(["Property", "Value"], rows));
    console.log(
      `\n${c.bold}Next Steps:${c.reset}\n  $ crucible run -s ${session.id} "your prompt here"\n  $ crucible session-send ${session.id} "your message"\n`,
    );

    return 0;
  } catch (err: any) {
    console.error(
      `\n${badge("ERROR", "fail")} Failed to create session: ${err.message}\n`,
    );
    return 1;
  }
}
