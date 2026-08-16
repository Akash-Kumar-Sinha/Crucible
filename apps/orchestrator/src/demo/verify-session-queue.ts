import { SessionManager } from "../session/session-manager";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class ControlledQueueProvider implements ModelProvider {
  readonly name = "controlled_queue";
  readonly defaultModel = "controlled_queue";
  readonly startedOrder: string[] = [];

  private readonly gates = new Map<
    string,
    { promise: Promise<void>; release: () => void }
  >();

  registerGate(prompt: string): void {
    if (this.gates.has(prompt)) {
      return;
    }

    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.gates.set(prompt, { promise, release });
  }

  release(prompt: string): void {
    this.gates.get(prompt)?.release();
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    const prompt = lastMessage?.content || "";
    const gate = this.gates.get(prompt);

    this.startedOrder.push(prompt);

    if (!gate) {
      throw new Error(`Missing queue gate for prompt: ${prompt}`);
    }

    await gate.promise;

    return {
      thought: `Finished queued prompt: ${prompt}`,
      content: `completed:${prompt}`,
      finishReason: "stop",
    };
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for queue state to settle.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function verifySessionQueueing() {
  console.log("\n============================================================");
  console.log("🧪 STARTING CRUCIBLE FIFO QUEUE VERIFICATION");
  console.log("============================================================\n");

  const provider = new ControlledQueueProvider();
  const manager = new SessionManager({
    defaultProvider: provider,
    maxConcurrentExecutions: 1,
  });

  const sessionA = await manager.createSession({
    sessionId: "queue_alpha",
    title: "Queue Alpha",
  });
  const sessionB = await manager.createSession({
    sessionId: "queue_beta",
    title: "Queue Beta",
  });
  const sessionC = await manager.createSession({
    sessionId: "queue_gamma",
    title: "Queue Gamma",
  });

  const queuedEvents: string[] = [];
  manager.on("sessionQueued", (summary) => {
    queuedEvents.push(summary.id);
    console.log(`[queue] queued ${summary.id} (${summary.status})`);
  });

  const prompts = {
    queue_alpha: "burst-job-alpha",
    queue_beta: "burst-job-beta",
    queue_gamma: "burst-job-gamma",
  } as const;

  for (const prompt of Object.values(prompts)) {
    provider.registerGate(prompt);
  }

  const runA = manager.dispatch(sessionA.id, prompts.queue_alpha);
  const runB = manager.dispatch(sessionB.id, prompts.queue_beta);
  const runC = manager.dispatch(sessionC.id, prompts.queue_gamma);

  await waitFor(() => provider.startedOrder.length >= 1);

  const queuedSnapshot = [sessionA, sessionB, sessionC].map((session) => ({
    id: session.id,
    status: session.getStatus(),
  }));
  console.log("Initial queue snapshot:", queuedSnapshot);

  if (provider.startedOrder[0] !== prompts.queue_alpha) {
    throw new Error(`Expected FIFO first start to be ${prompts.queue_alpha}.`);
  }

  provider.release(prompts.queue_alpha);
  const resultA = await runA;

  await waitFor(() => provider.startedOrder.length >= 2);
  if (provider.startedOrder[1] !== prompts.queue_beta) {
    throw new Error(`Expected second start to be ${prompts.queue_beta}.`);
  }

  provider.release(prompts.queue_beta);
  const resultB = await runB;

  await waitFor(() => provider.startedOrder.length >= 3);
  if (provider.startedOrder[2] !== prompts.queue_gamma) {
    throw new Error(`Expected third start to be ${prompts.queue_gamma}.`);
  }

  provider.release(prompts.queue_gamma);
  const resultC = await runC;

  const finalStatuses = [sessionA, sessionB, sessionC].map((session) => ({
    id: session.id,
    status: session.getStatus(),
    turns: session.getSummary().turnCount,
    response: session.getMessages().at(-1)?.content,
  }));

  console.log("Final queue snapshot:", finalStatuses);
  console.log("Start order:", provider.startedOrder);

  const success =
    queuedEvents.length >= 2 &&
    provider.startedOrder.join("|") ===
      [prompts.queue_alpha, prompts.queue_beta, prompts.queue_gamma].join(
        "|",
      ) &&
    resultA.finalResponse === `completed:${prompts.queue_alpha}` &&
    resultB.finalResponse === `completed:${prompts.queue_beta}` &&
    resultC.finalResponse === `completed:${prompts.queue_gamma}` &&
    sessionA.getStatus() === "done" &&
    sessionB.getStatus() === "done" &&
    sessionC.getStatus() === "done";

  if (!success) {
    throw new Error("FIFO queue verification failed.");
  }

  console.log(
    "\n>>> SUCCESS: Excess dispatches were queued and drained in FIFO order. <<<",
  );

  manager.clear();
  process.exit(0);
}

verifySessionQueueing().catch((err) => {
  console.error("Queue verification failed:", err);
  process.exit(1);
});
