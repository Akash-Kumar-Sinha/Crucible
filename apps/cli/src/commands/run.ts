import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CrucibleClient } from "@crucible/sdk";
import { c, printBanner } from "../formatters";

export interface RunCommandOptions {
  prompt?: string;
  interactive?: boolean;
  sessionId?: string;
  endpoint?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  title?: string;
  async?: boolean;
  stream?: boolean;
}

export async function runAgentCommand(
  promptArg?: string,
  options: RunCommandOptions = {},
): Promise<number> {
  const endpoint =
    options.endpoint ||
    process.env.CRUCIBLE_ENDPOINT ||
    (process.env.PORT
      ? `http://localhost:${process.env.PORT}`
      : "http://localhost:4000");

  const client = new CrucibleClient({
    endpoint,
    tenantId: options.tenantId,
    namespace: options.namespace,
  });

  const shouldStream = options.stream !== false;
  let sessionId = options.sessionId;

  if (!sessionId) {
    try {
      const session = await client.sessions.create({
        title:
          options.title ||
          (promptArg ? `CLI: ${promptArg.slice(0, 30)}` : "CLI Session"),
        role: options.role,
        model: options.model,
        tenantId: options.tenantId,
        namespace: options.namespace,
      });
      sessionId = session.id;
    } catch (err: any) {
      console.error(
        `${c.red}Failed to create session on orchestrator:${c.reset} ${err.message || err}`,
      );
      console.error(
        `Ensure orchestrator is reachable at ${c.bold}${endpoint}${c.reset}`,
      );
      return 1;
    }
  }

  const promptText = promptArg || options.prompt;
  const isInteractive = options.interactive || !promptText;

  if (!isInteractive && promptText) {
    printBanner(
      "Crucible Agent Runner",
      `Session: ${sessionId} | Endpoint: ${endpoint}`,
    );
    console.log(`${c.blue}${c.bold}[User Prompt]:${c.reset} ${promptText}\n`);

    try {
      await executeTurn(client, sessionId, promptText, shouldStream);
      return 0;
    } catch (err: any) {
      console.error(
        `\n${c.red}Execution failed:${c.reset} ${err.message || err}\n`,
      );
      return 1;
    }
  }

  // Interactive REPL Mode
  const rl = readline.createInterface({ input, output });
  printBanner(
    "Crucible Interactive Agent REPL",
    `Session: ${sessionId} | Type '/help' for commands`,
  );

  try {
    while (true) {
      let userInput: string;
      try {
        userInput = await rl.question(
          `${c.bold}${c.blue}crucible (${sessionId.slice(-6)})${c.reset} > `,
        );
      } catch {
        break;
      }

      const trimmed = userInput.trim();
      if (!trimmed) continue;

      if (
        trimmed === "exit" ||
        trimmed === "quit" ||
        trimmed === "/exit" ||
        trimmed === "/quit" ||
        trimmed === "/q"
      ) {
        console.log("Exiting Crucible CLI. Goodbye!");
        break;
      }

      if (trimmed === "/help") {
        printReplHelp();
        continue;
      }

      if (trimmed === "/status") {
        await printSessionStatus(client, sessionId);
        continue;
      }

      if (trimmed === "/history") {
        await printSessionHistory(client, sessionId);
        continue;
      }

      if (trimmed === "/clear") {
        const newSession = await client.sessions.create({
          title: "CLI Session",
          role: options.role,
          model: options.model,
          tenantId: options.tenantId,
          namespace: options.namespace,
        });
        sessionId = newSession.id;
        console.log(
          `\n${c.green}Started fresh conversation with session ID: ${sessionId}${c.reset}\n`,
        );
        continue;
      }

      console.log("");
      try {
        await executeTurn(client, sessionId, trimmed, shouldStream, rl);
      } catch (err: any) {
        console.error(
          `\n${c.red}Execution error:${c.reset} ${err.message || err}\n`,
        );
      }
      console.log("");
    }
  } finally {
    rl.close();
  }

  return 0;
}

async function executeTurn(
  client: CrucibleClient,
  sessionId: string,
  prompt: string,
  shouldStream: boolean,
  rl?: readline.Interface,
): Promise<void> {
  if (!shouldStream) {
    const res = await client.sessions.prompt(sessionId, prompt);
    console.log(
      `\n${c.bold}[Agent Response]:${c.reset} ${res.response || "(No response text)"}\n`,
    );
    return;
  }

  let isThinking = false;
  let isStreamingTokens = false;

  // Launch stream subscription in background
  const streamPromise = client.sessions.stream(sessionId, {
    onThought: (chunk) => {
      if (!isThinking) {
        isThinking = true;
        process.stdout.write(
          `\n${c.yellow}${c.bold}[Thinking]:${c.reset}${c.dim}${c.yellow} `,
        );
      }
      process.stdout.write(chunk);
    },

    onToken: (token) => {
      if (isThinking) {
        process.stdout.write(`${c.reset}\n`);
        isThinking = false;
      }
      if (!isStreamingTokens) {
        isStreamingTokens = true;
        process.stdout.write(`\n${c.bold}${c.white}[Response]:${c.reset} `);
      }
      process.stdout.write(token);
    },

    onAction: (actions) => {
      if (isThinking) {
        process.stdout.write(`${c.reset}\n`);
        isThinking = false;
      }
      if (isStreamingTokens) {
        process.stdout.write("\n");
        isStreamingTokens = false;
      }
      for (const a of actions) {
        console.log(
          `\n${c.magenta}${c.bold}[Action -> Tool Call]:${c.reset} ${c.bold}${a.name}${c.reset} (id: ${a.id})`,
        );
        console.log(
          `  ${c.dim}${JSON.stringify(a.arguments || {}, null, 2)}${c.reset}`,
        );
      }
    },

    onObservation: (observations) => {
      for (const o of observations) {
        const color = o.status === "success" ? c.green : c.red;
        console.log(
          `\n${color}${c.bold}[Observation <- Tool Result]:${c.reset} ${o.name} (${o.status})`,
        );
        if (o.output) {
          const outStr =
            typeof o.output === "string"
              ? o.output
              : JSON.stringify(o.output, null, 2);
          console.log(
            `  ${outStr.slice(0, 500)}${outStr.length > 500 ? "..." : ""}`,
          );
        }
        if (o.error) {
          console.log(`  ${c.red}Error: ${JSON.stringify(o.error)}${c.reset}`);
        }
      }
    },

    onStateChange: async (state) => {
      if (state === "awaiting_human" && rl) {
        if (isThinking || isStreamingTokens) {
          process.stdout.write(`${c.reset}\n`);
          isThinking = false;
          isStreamingTokens = false;
        }
        console.log(
          `\n${c.bgYellow}${c.black}${c.bold} SECURITY APPROVAL REQUIRED ${c.reset}`,
        );
        const answer = await rl.question(
          `Authorize sandboxed execution? [y/N]: `,
        );
        const approved =
          answer.trim().toLowerCase() === "y" ||
          answer.trim().toLowerCase() === "yes";
        await client.sessions.approve(sessionId, {
          approved,
          reason: approved ? undefined : "Denied by user in CLI",
        });
      }
    },

    onDone: () => {
      if (isThinking || isStreamingTokens) {
        process.stdout.write(`${c.reset}\n`);
        isThinking = false;
        isStreamingTokens = false;
      }
    },

    onError: (err) => {
      if (isThinking || isStreamingTokens) {
        process.stdout.write(`${c.reset}\n`);
      }
      console.error(
        `\n${c.red}[Stream Error]: ${err instanceof Error ? err.message : JSON.stringify(err)}${c.reset}`,
      );
    },
  });

  // Dispatch message to orchestrator
  await client.sessions.prompt(sessionId, prompt);
  await streamPromise;
}

function printReplHelp(): void {
  console.log("\nAvailable REPL Commands:");
  console.log(`  ${c.bold}/help${c.reset}       - Show this command reference`);
  console.log(
    `  ${c.bold}/status${c.reset}     - Inspect session status and metadata`,
  );
  console.log(
    `  ${c.bold}/history${c.reset}    - Display conversational message history`,
  );
  console.log(
    `  ${c.bold}/clear${c.reset}      - Start a new conversation session`,
  );
  console.log(
    `  ${c.bold}/exit, /q${c.reset}  - Terminate interactive CLI REPL\n`,
  );
}

async function printSessionStatus(
  client: CrucibleClient,
  sessionId: string,
): Promise<void> {
  try {
    const detail = await client.sessions.get(sessionId);
    console.log(`\n${c.bold}Session Status:${c.reset}`);
    console.log(`  • ID:        ${detail.id}`);
    console.log(`  • Title:     ${detail.title}`);
    console.log(`  • Status:    ${detail.status}`);
    console.log(`  • Role:      ${detail.role || "general"}`);
    console.log(`  • Model:     ${detail.model || "default"}`);
    console.log(`  • Messages:  ${detail.messages.length}\n`);
  } catch (err: any) {
    console.error(
      `${c.red}Failed to fetch status:${c.reset} ${err.message || err}`,
    );
  }
}

async function printSessionHistory(
  client: CrucibleClient,
  sessionId: string,
): Promise<void> {
  try {
    const detail = await client.sessions.get(sessionId);
    console.log(
      `\n${c.bold}--- Message History (${detail.messages.length} messages) ---${c.reset}`,
    );
    for (const m of detail.messages) {
      const color =
        m.role === "user"
          ? c.blue
          : m.role === "assistant"
            ? c.green
            : c.magenta;
      console.log(
        `[${color}${m.role.toUpperCase()}${c.reset}]: ${m.content || "(tool execution step)"}`,
      );
    }
    console.log("");
  } catch (err: any) {
    console.error(
      `${c.red}Failed to fetch history:${c.reset} ${err.message || err}`,
    );
  }
}
