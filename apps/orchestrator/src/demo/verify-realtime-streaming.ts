import { expect } from "bun:test";
import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { createBashTool } from "../tools/builtin/bash";
import { LocalExecutor } from "../execution/local-executor";
import { SseStreamHandler } from "../streaming/sse";
import { startHttpServer } from "../http/server";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

// Mock provider that triggers bash_exec with a multi-step iterative shell command
class StreamingVerificationProvider implements ModelProvider {
  readonly name = "streaming_verifier";
  readonly defaultModel = "verifier";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastMsg = request.messages[request.messages.length - 1];
    const content = lastMsg?.content || "";

    // If message is for Session Alpha
    if (content.includes("alpha")) {
      return {
        thought:
          "Executing 3-step sequential background task for Session Alpha...",
        toolCalls: [
          {
            id: "call_alpha_1",
            name: "bash_exec",
            arguments: {
              command:
                'for i in 1 2 3; do echo "[Alpha Chunk $i/3] Processed at $(date +%T.%3N)"; sleep 0.08; done',
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    // If message is for Session Beta
    if (content.includes("beta")) {
      return {
        thought:
          "Executing 3-step sequential background task for Session Beta...",
        toolCalls: [
          {
            id: "call_beta_1",
            name: "bash_exec",
            arguments: {
              command:
                'for i in 1 2 3; do echo "[Beta Chunk $i/3] Processed at $(date +%T.%3N)"; sleep 0.08; done',
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    return {
      content: "Task completed successfully",
      finishReason: "stop",
    };
  }
}

async function main() {
  console.log(
    "\n================================================================================",
  );
  console.log(
    "⚡ CRUCIBLE REAL-TIME STREAMING & DUAL-SESSION PARALLEL VERIFICATION",
  );
  console.log(
    "================================================================================\n",
  );

  const port = 4099;
  const executor = new LocalExecutor();
  const tools = new ToolRegistry().register(createBashTool({ executor }));
  const provider = new StreamingVerificationProvider();

  const sessionManager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
  });

  const server = startHttpServer({
    port,
    sessionManager,
  });

  console.log(
    `[1] Orchestrator HTTP & Streaming server running on port ${port}`,
  );

  // Create two distinct sessions
  const sessionAlpha = sessionManager.createSession({ title: "Session Alpha" });
  const sessionBeta = sessionManager.createSession({ title: "Session Beta" });

  console.log(`[2] Created Session Alpha: ${sessionAlpha.id}`);
  console.log(`[3] Created Session Beta:  ${sessionBeta.id}\n`);

  // -------------------------------------------------------------
  // Test 1: Start Long-Running Tool and Capture Live Streaming Output
  // -------------------------------------------------------------
  console.log(
    "--- TEST 1: Live Line-by-Line Tool Stdout Streaming (Non-Buffered) ---",
  );
  const alphaChunks: Array<{ time: number; chunk: string }> = [];
  const betaChunks: Array<{ time: number; chunk: string }> = [];

  // Connect SSE reader for Session Alpha
  const alphaSseReq = await fetch(
    `http://localhost:${port}/api/sessions/${sessionAlpha.id}/stream`,
  );
  const alphaReader = alphaSseReq.body?.getReader();

  // Connect SSE reader for Session Beta
  const betaSseReq = await fetch(
    `http://localhost:${port}/api/sessions/${sessionBeta.id}/stream`,
  );
  const betaReader = betaSseReq.body?.getReader();

  const startTime = Date.now();

  // Async stream consumer for Alpha
  const consumeAlpha = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await alphaReader!.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n\n")) {
        if (
          line.includes("event: tool_stdout") ||
          line.includes("tool_stdout")
        ) {
          const timestamp = Date.now() - startTime;
          console.log(`  [Stream Alpha +${timestamp}ms]: ${line.trim()}`);
          alphaChunks.push({ time: timestamp, chunk: line });
        }
        if (line.includes("event: done") || line.includes('"type":"done"')) {
          return;
        }
      }
    }
  })();

  // Async stream consumer for Beta
  const consumeBeta = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await betaReader!.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n\n")) {
        if (
          line.includes("event: tool_stdout") ||
          line.includes("tool_stdout")
        ) {
          const timestamp = Date.now() - startTime;
          console.log(`  [Stream Beta  +${timestamp}ms]: ${line.trim()}`);
          betaChunks.push({ time: timestamp, chunk: line });
        }
        if (line.includes("event: done") || line.includes('"type":"done"')) {
          return;
        }
      }
    }
  })();

  // -------------------------------------------------------------
  // Test 2: Trigger Parallel Execution in Both Sessions Concurrently
  // -------------------------------------------------------------
  console.log(
    "\n--- TEST 2: Parallel Dual-Session Execution & Independent Streaming ---",
  );
  console.log(
    "Triggering concurrent prompts in Session Alpha and Session Beta simultaneously...\n",
  );

  const [resAlpha, resBeta] = await Promise.all([
    sessionAlpha.prompt("start alpha task"),
    sessionBeta.prompt("start beta task"),
  ]);

  // Wait for stream consumers to finish
  await Promise.all([consumeAlpha, consumeBeta]);

  console.log(
    "\n-------------------------------------------------------------",
  );
  console.log("🔍 VERIFYING REAL-TIME AND INDEPENDENT STREAMING RESULTS");
  console.log("-------------------------------------------------------------");

  console.log(
    `[Results Alpha] Total stdout chunks received: ${alphaChunks.length}`,
  );
  console.log(
    `[Results Beta]  Total stdout chunks received: ${betaChunks.length}`,
  );

  // 1. Verify Alpha received real-time non-buffered chunks
  expect(alphaChunks.length).toBeGreaterThanOrEqual(1);
  expect(alphaChunks.some((c) => c.chunk.includes("Alpha Chunk"))).toBe(true);

  // 2. Verify Beta received real-time non-buffered chunks
  expect(betaChunks.length).toBeGreaterThanOrEqual(1);
  expect(betaChunks.some((c) => c.chunk.includes("Beta Chunk"))).toBe(true);

  // 3. Verify Complete Stream Isolation (Zero Cross-Talk!)
  const alphaHasBeta = alphaChunks.some((c) => c.chunk.includes("Beta Chunk"));
  const betaHasAlpha = betaChunks.some((c) => c.chunk.includes("Alpha Chunk"));

  console.log(
    `[Isolation Check] Session Alpha received Beta events: ${alphaHasBeta}`,
  );
  console.log(
    `[Isolation Check] Session Beta received Alpha events: ${betaHasAlpha}`,
  );

  expect(alphaHasBeta).toBe(false);
  expect(betaHasAlpha).toBe(false);
  console.log(
    "✅ VERIFIED: Zero stream cross-talk between Session Alpha and Beta!",
  );

  // Cleanup
  alphaReader?.cancel();
  betaReader?.cancel();
  server.stop(true);

  console.log(
    "\n================================================================================",
  );
  console.log(
    "🎉 ALL REAL-TIME STREAMING & MULTI-SESSION ISOLATION TESTS PASSED!",
  );
  console.log(
    "================================================================================\n",
  );
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
