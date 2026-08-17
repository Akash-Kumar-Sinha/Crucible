import { runDoctorCommand } from "./commands/doctor";
import { runToolsListCommand } from "./commands/tools-list";
import { runSandboxLogsCommand } from "./commands/sandbox-logs";
import { runAgentCommand } from "./commands/run";
import { runSessionCreateCommand } from "./commands/session-create";
import { runSessionSendCommand } from "./commands/session-send";
import { runContextUsageCommand } from "./commands/context-usage";
import { runAuditTailCommand } from "./commands/audit-tail";
import { runMetricsCommand } from "./commands/metrics";
import { c } from "./formatters";

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const equalsIdx = arg.indexOf("=");
      if (equalsIdx !== -1) {
        const key = arg.slice(2, equalsIdx);
        const value = arg.slice(equalsIdx + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          flags[key] = nextArg;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const shortFlag = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        flags[shortFlag] = nextArg;
        i++;
      } else {
        flags[shortFlag] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  const command = positional[0] || "help";
  const subcommand = positional[1];

  return {
    command,
    subcommand,
    positional: positional.slice(1),
    flags,
  };
}

export function printGlobalHelp(): void {
  console.log(`
${c.bold}${c.magenta}CRUCIBLE CLI${c.reset} - Universal AI Agent Harness & Developer Toolkit

${c.bold}USAGE:${c.reset}
  $ crucible <command> [arguments] [flags]

${c.bold}CORE AGENT & SESSION COMMANDS:${c.reset}
  session-create                Create an agent session with role, model & tenant options
  session-send <id> "msg"       Send a prompt turn to an agent session
  context-usage <id>           Inspect token utilization, limit bar & Memento compaction

${c.bold}OBSERVABILITY & SECURITY COMMANDS:${c.reset}
  audit-tail [id]               Stream Bug Hunter cryptographic audit trail (--verify)
  metrics [id]                  Plain-text dump of the Metrics Dashboard panels
  doctor                       Run comprehensive deployment & subsystem health diagnostics
  tools-list                   List all registered tools, parameters, and approval rules
  sandbox-logs <id>            Inspect cgroups, OverlayFS, network policy & container logs

${c.bold}GLOBAL FLAGS:${c.reset}
  -e, --endpoint <url>           Target orchestrator REST endpoint (default: http://localhost:4000)
  -r, --role <role>              Specialized role (coder, test_writer, bug_hunter, bug_fixer)
  -m, --model <slug>             Model slug (e.g. anthropic/claude-3.5-sonnet, openai/gpt-4o)
  -s, --session <id>             Session ID target
  -t, --tenant <id>              Multi-tenant isolation scope
  -n, --namespace <ns>           Kubernetes workload namespace
  --verify                      Verify cryptographic SHA-256 hash chain integrity in audit-tail
  --json                        Output raw machine-readable JSON
  -i, --interactive              Launch interactive multi-turn REPL
  -h, --help                     Show this command line reference
  -v, --version                  Print version number

${c.bold}EXAMPLES:${c.reset}
  $ crucible session-create --role bug_hunter --model anthropic/claude-3.5-sonnet
  $ crucible session-send sess_123 "Fix memory leak in websocket stream"
  $ crucible context-usage sess_123
  $ crucible audit-tail sess_123 --verify
  $ crucible metrics
  $ crucible doctor
`);
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const parsed = parseCliArgs(argv);

  const endpoint =
    (parsed.flags["endpoint"] as string) ||
    (parsed.flags["e"] as string) ||
    process.env.CRUCIBLE_ENDPOINT ||
    (process.env.PORT
      ? `http://localhost:${process.env.PORT}`
      : "http://localhost:4000");

  const tenantId =
    (parsed.flags["tenant"] as string) || (parsed.flags["t"] as string);
  const namespace =
    (parsed.flags["namespace"] as string) || (parsed.flags["n"] as string);
  const json = Boolean(parsed.flags["json"]);

  if (
    parsed.flags["version"] ||
    parsed.flags["v"] ||
    parsed.command === "version"
  ) {
    console.log("crucible-cli v0.1.0");
    return 0;
  }

  if (parsed.flags["help"] || parsed.flags["h"] || parsed.command === "help") {
    printGlobalHelp();
    return 0;
  }

  switch (parsed.command) {
    case "doctor":
      return runDoctorCommand({
        endpoint,
        timeout: parsed.flags["timeout"]
          ? Number(parsed.flags["timeout"])
          : undefined,
        json,
        verbose: Boolean(parsed.flags["verbose"] || parsed.flags["v"]),
      });

    case "session-create":
    case "session:create":
    case "create-session":
      return runSessionCreateCommand({
        endpoint,
        title: (parsed.flags["title"] as string) || parsed.positional.join(" "),
        role: (parsed.flags["role"] as string) || (parsed.flags["r"] as string),
        model:
          (parsed.flags["model"] as string) || (parsed.flags["m"] as string),
        tenantId,
        namespace,
        systemPrompt: parsed.flags["system-prompt"] as string,
        json,
      });

    case "session-send":
    case "session:send":
    case "send": {
      const sessionId =
        (parsed.flags["session"] as string) ||
        (parsed.flags["s"] as string) ||
        parsed.positional[0] ||
        "";
      const message =
        parsed.positional.length > 1
          ? parsed.positional.slice(1).join(" ")
          : (parsed.flags["message"] as string) || "";
      return runSessionSendCommand(sessionId, message, {
        endpoint,
        priority: parsed.flags["priority"] as any,
        async: Boolean(parsed.flags["async"]),
        tenantId,
        namespace,
        json,
      });
    }

    case "context-usage":
    case "context:usage":
    case "context": {
      const sessionId =
        parsed.positional[0] ||
        (parsed.flags["session"] as string) ||
        (parsed.flags["s"] as string) ||
        "";
      return runContextUsageCommand(sessionId, {
        endpoint,
        tenantId,
        namespace,
        json,
      });
    }

    case "audit-tail":
    case "audit:tail":
    case "audit": {
      const sessionId =
        parsed.positional[0] ||
        (parsed.flags["session"] as string) ||
        (parsed.flags["s"] as string);
      return runAuditTailCommand(sessionId, {
        endpoint,
        limit: parsed.flags["limit"]
          ? Number(parsed.flags["limit"])
          : undefined,
        verify: Boolean(parsed.flags["verify"]),
        tenantId,
        namespace,
        json,
      });
    }

    case "audit-verify":
    case "audit:verify":
      return runAuditTailCommand(undefined, {
        endpoint,
        verify: true,
        tenantId,
        namespace,
        json,
      });

    case "metrics":
    case "metrics:summary":
    case "metrics-summary": {
      const sessionId =
        parsed.positional[0] ||
        (parsed.flags["session"] as string) ||
        (parsed.flags["s"] as string);
      return runMetricsCommand(sessionId, {
        endpoint,
        tenantId,
        namespace,
        json,
      });
    }

    case "tools-list":
    case "tools:list":
    case "tools":
      return runToolsListCommand({
        endpoint,
        category:
          (parsed.flags["category"] as string) || (parsed.flags["c"] as string),
        json,
      });

    case "sandbox-logs":
    case "sandbox:logs":
    case "logs":
      return runSandboxLogsCommand(
        parsed.positional[0] || (parsed.flags["session"] as string),
        {
          endpoint,
          json,
          turns: Boolean(parsed.flags["turns"]),
        },
      );

    case "run": {
      const prompt = parsed.positional.join(" ").trim();
      return runAgentCommand(prompt, {
        endpoint,
        interactive: Boolean(parsed.flags["interactive"] || parsed.flags["i"]),
        sessionId:
          (parsed.flags["session"] as string) || (parsed.flags["s"] as string),
        role: (parsed.flags["role"] as string) || (parsed.flags["r"] as string),
        model:
          (parsed.flags["model"] as string) || (parsed.flags["m"] as string),
        tenantId,
        namespace,
        title: parsed.flags["title"] as string,
        stream: parsed.flags["stream"] !== false && !parsed.flags["no-stream"],
      });
    }

    default: {
      // If user typed a direct prompt e.g. `crucible "list files"`
      if (parsed.command) {
        const fullPrompt = [parsed.command, ...parsed.positional]
          .join(" ")
          .trim();
        return runAgentCommand(fullPrompt, {
          endpoint,
          interactive: Boolean(
            parsed.flags["interactive"] || parsed.flags["i"],
          ),
          sessionId:
            (parsed.flags["session"] as string) ||
            (parsed.flags["s"] as string),
          role:
            (parsed.flags["role"] as string) || (parsed.flags["r"] as string),
          model:
            (parsed.flags["model"] as string) || (parsed.flags["m"] as string),
          tenantId,
          namespace,
          title: parsed.flags["title"] as string,
          stream:
            parsed.flags["stream"] !== false && !parsed.flags["no-stream"],
        });
      }

      // No arguments passed -> Launch interactive REPL by default
      return runAgentCommand(undefined, {
        endpoint,
        interactive: true,
        role: (parsed.flags["role"] as string) || (parsed.flags["r"] as string),
        model:
          (parsed.flags["model"] as string) || (parsed.flags["m"] as string),
        tenantId,
        namespace,
      });
    }
  }
}
