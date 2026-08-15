import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SessionManager } from "../session/session-manager";
import {
  ToolRegistry,
  calculatorTool,
  getCurrentTimeTool,
  createBashTool,
  readFileTool,
  dangerousShellTool,
} from "../tools";
import { LocalExecutor } from "../execution/local-executor";
import { OpenRouterProvider } from "../provider/openrouter";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";
import type { Session } from "../session/session";

function printBanner() {
  console.log(
    "\n╔══════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║               CRUCIBLE INTERACTIVE AGENT CLI                     ║",
  );
  console.log(
    "║   Type your prompt below or '/help' for interactive commands.    ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════╝\n",
  );
}

function attachSessionEventVisualizer(session: Session) {
  let isThinking = false;
  let isStreamingTokens = false;

  session.on("stateChange", (to, from) => {
    if (isThinking) {
      process.stdout.write("\x1b[0m\n");
      isThinking = false;
    }
    if (isStreamingTokens) {
      process.stdout.write("\n");
      isStreamingTokens = false;
    }
    console.log(`\x1b[36m[State]:\x1b[0m ${from} ──> \x1b[1m${to}\x1b[0m`);
  });

  session.on("thought", (thoughtChunk) => {
    if (!isThinking) {
      isThinking = true;
      process.stdout.write(`\n\x1b[33m[Thinking]:\x1b[0m\x1b[2;33m `);
    }
    process.stdout.write(thoughtChunk);
  });

  session.on("token", (tokenChunk) => {
    if (isThinking) {
      process.stdout.write("\x1b[0m\n");
      isThinking = false;
    }
    if (!isStreamingTokens) {
      isStreamingTokens = true;
      process.stdout.write(`\n\x1b[1;37m[Response]:\x1b[0m `);
    }
    process.stdout.write(tokenChunk);
  });

  session.on("action", (actions) => {
    if (isThinking) {
      process.stdout.write("\x1b[0m\n");
      isThinking = false;
    }
    if (isStreamingTokens) {
      process.stdout.write("\n");
      isStreamingTokens = false;
    }
    for (const a of actions) {
      console.log(
        `\n\x1b[35m[Action -> Tool Call]:\x1b[0m \x1b[1m${a.name}\x1b[0m (id: ${a.id})`,
      );
      console.log(`  Arguments: ${JSON.stringify(a.arguments, null, 2)}`);
    }
  });

  session.on("observation", (obs) => {
    for (const o of obs) {
      const color = o.status === "success" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `\n${color}[Observation <- Tool Result]:\x1b[0m \x1b[1m${o.name}\x1b[0m (${o.status})`,
      );
      console.log(`  Output: ${JSON.stringify(o.output, null, 2)}`);
      if (o.error) console.log(`  \x1b[31mError: ${o.error}\x1b[0m`);
    }
  });

  session.on("done", (_finalText) => {
    if (isThinking) {
      process.stdout.write("\x1b[0m\n");
      isThinking = false;
    }
    if (isStreamingTokens) {
      process.stdout.write("\n");
      isStreamingTokens = false;
    }
    console.log("\n\x1b[32m✔ Turn completed successfully.\x1b[0m\n");
  });

  session.on("error", (err) => {
    if (isThinking || isStreamingTokens) {
      process.stdout.write("\x1b[0m\n");
      isThinking = false;
      isStreamingTokens = false;
    }
    console.error(`\n\x1b[31m[Session Error]: ${err.message || err}\x1b[0m\n`);
  });
}

async function runInteractiveRepl(session: Session, rl: readline.Interface) {
  printBanner();

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question("\x1b[1;34mcrucible\x1b[0m > ");
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
      console.log("\nAvailable Commands:");
      console.log("  /help       - Show this help message");
      console.log(
        "  /history    - Display current message history in this session",
      );
      console.log("  /status     - Show session metadata and status");
      console.log("  /clear      - Start a fresh session conversation");
      console.log("  /exit, quit, q - Exit the interactive REPL\n");
      continue;
    }

    if (trimmed === "/history") {
      console.log("\n--- Session Message History ---");
      const msgs = session.getMessages();
      for (const m of msgs) {
        console.log(
          `[${m.role.toUpperCase()}]: ${m.content || "(tool call: " + JSON.stringify(m.toolCalls) + ")"}`,
        );
      }
      console.log(`Total Messages: ${msgs.length}\n`);
      continue;
    }

    if (trimmed === "/status") {
      const summary = session.getSummary();
      console.log("\n--- Session Summary ---");
      console.log(`ID:        ${summary.id}`);
      console.log(`Status:    ${summary.status}`);
      console.log(`TurnCount: ${summary.turnCount}`);
      console.log(`StepCount: ${summary.stepCount}`);
      console.log(`Messages:  ${summary.messageCount}\n`);
      continue;
    }

    console.log(`\n\x1b[34m[User]:\x1b[0m "${trimmed}"\n`);
    try {
      await session.prompt(trimmed);
    } catch (err: any) {
      console.error(
        "\x1b[31mTurn execution failed:\x1b[0m",
        err?.message || err,
      );
    }
  }
}

async function main() {
  const localExecutor = new LocalExecutor({
    defaultTimeoutMs: 30_000,
  });

  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(getCurrentTimeTool)
    .register(createBashTool({ executor: localExecutor }))
    .register(readFileTool)
    .register(dangerousShellTool);

  const apiKey = process.env.OPENROUTER || process.env.OPENROUTER_API_KEY;
  let provider: ModelProvider;

  if (apiKey) {
    provider = new OpenRouterProvider({
      defaultModel: process.env.OPENROUTER_MODEL || "openrouter/free",
    });
  } else {
    console.warn(
      "\x1b[33m[Notice]: No OPENROUTER API key in .env. Running deterministic demo provider.\x1b[0m",
    );
    class MockCliProvider implements ModelProvider {
      name = "mock_cli_provider";
      defaultModel = "demo-model";
      private turn = 0;

      async complete(request: ModelRequest): Promise<ModelResponse> {
        this.turn++;
        const lastMsg = request.messages[request.messages.length - 1];

        if (lastMsg.role === "tool") {
          const thought = "Received tool output. Answering user.";
          const content = `Tool executed successfully: ${lastMsg.content}`;

          if (request.onThought) {
            for (const word of thought.split(" ")) {
              request.onThought(`${word} `);
              await new Promise((r) => setTimeout(r, 25));
            }
          }

          if (request.onToken) {
            for (const word of content.split(" ")) {
              request.onToken(`${word} `);
              await new Promise((r) => setTimeout(r, 20));
            }
          }

          return {
            thought,
            content,
            finishReason: "stop",
          };
        }

        const thought = "Inspecting environment via bash_exec.";
        if (request.onThought) {
          for (const word of thought.split(" ")) {
            request.onThought(`${word} `);
            await new Promise((r) => setTimeout(r, 25));
          }
        }

        return {
          thought,
          toolCalls: [
            {
              id: `call_${Date.now()}`,
              name: "bash_exec",
              arguments: { command: "uname -a" },
            },
          ],
          finishReason: "tool_calls",
        };
      }
    }
    provider = new MockCliProvider();
  }

  const rl = readline.createInterface({ input, output });

  const manager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
    defaultSystemPrompt:
      "You are Crucible, an autonomous AI execution assistant. You have access to bash_exec to run shell commands, calculator for math, and get_current_time. Think clearly inside <thought>...</thought> tags, execute appropriate tools, and provide concise solutions.",
  });

  const session = manager.createSession({
    sessionId: `cli_${Date.now().toString(36)}`,
    title: "Interactive User CLI Session",
    onHumanApprovalRequired: async (pendingCalls) => {
      console.log("\n\x1b[31;1m[SECURITY APPROVAL REQUIRED]\x1b[0m");
      for (const call of pendingCalls) {
        console.log(
          `Tool: \x1b[1m${call.name}\x1b[0m | Args: ${JSON.stringify(call.arguments)}`,
        );
      }
      const answer = await rl.question("\nAuthorize this execution? [y/N]: ");
      const approved =
        answer.trim().toLowerCase() === "y" ||
        answer.trim().toLowerCase() === "yes";
      return {
        approved,
        reason: approved ? undefined : "User denied permission.",
      };
    },
  });

  attachSessionEventVisualizer(session);

  // Check if a single-shot prompt argument was passed via CLI (e.g. `bun run cli "my prompt"`)
  const cliArgs = process.argv.slice(2).join(" ").trim();

  if (cliArgs) {
    console.log(`\n\x1b[34m[Single-Shot Command]:\x1b[0m "${cliArgs}"\n`);
    await session.prompt(cliArgs);
    rl.close();
  } else {
    // Interactive multi-turn REPL loop
    await runInteractiveRepl(session, rl);
    rl.close();
  }
}

main().catch((err) => {
  console.error("Fatal CLI Error:", err);
  process.exit(1);
});
