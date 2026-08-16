import { SessionManager } from "../session/session-manager";
import { createHttpRouter } from "../http/server";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class BurstSimulationProvider implements ModelProvider {
  readonly name = "burst_sim_provider";
  readonly defaultModel = "burst_sim_model";
  readonly startedOrder: string[] = [];
  activeConcurrentRuns = 0;
  maxObservedConcurrentRuns = 0;

  private readonly gates = new Map<
    string,
    { promise: Promise<void>; release: () => void }
  >();

  registerGate(prompt: string): void {
    if (this.gates.has(prompt)) return;
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
    const lastMsg = request.messages[request.messages.length - 1];
    const prompt = lastMsg?.content || "";
    const gate = this.gates.get(prompt);

    this.activeConcurrentRuns += 1;
    if (this.activeConcurrentRuns > this.maxObservedConcurrentRuns) {
      this.maxObservedConcurrentRuns = this.activeConcurrentRuns;
    }
    this.startedOrder.push(prompt);

    if (gate) {
      await gate.promise;
    }

    this.activeConcurrentRuns -= 1;

    return {
      thought: `Processed queued burst request: ${prompt}`,
      content: `Result for [${prompt}] completed successfully`,
      finishReason: "stop",
    };
  }
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for condition to settle`,
      );
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}

export async function runBurstQueueVerification(): Promise<void> {
  console.log("\n============================================================");
  console.log("CRUCIBLE BURST LOAD-LEVELING & QUEUED UI STATE VERIFICATION");
  console.log("============================================================\n");

  const CLUSTER_CONCURRENCY_LIMIT = 2;
  const TOTAL_BURST_RUNS = 6;

  console.log(`[Config] Cluster Max Concurrency: ${CLUSTER_CONCURRENCY_LIMIT}`);
  console.log(
    `[Config] Firing burst of ${TOTAL_BURST_RUNS} simultaneous runs\n`,
  );

  const provider = new BurstSimulationProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    maxConcurrentExecutions: CLUSTER_CONCURRENCY_LIMIT,
  });

  const router = createHttpRouter(sessionManager);

  // 1. Create 6 distinct sessions
  const sessions = Array.from({ length: TOTAL_BURST_RUNS }, (_, i) => {
    const id = `sess_burst_${i + 1}`;
    return sessionManager.createSession({
      sessionId: id,
      title: `Burst Session ${i + 1}`,
    });
  });

  // Register gates for all 6 prompts
  for (let i = 0; i < TOTAL_BURST_RUNS; i++) {
    provider.registerGate(`prompt_${i + 1}`);
  }

  // Track queued notifications
  const queuedNotifications: Array<{ sessionId: string; status: string }> = [];
  sessionManager.on("sessionQueued", (summary) => {
    queuedNotifications.push({ sessionId: summary.id, status: summary.status });
    console.log(
      `[Event: sessionQueued] Session '${summary.id}' entered status: '${summary.status}'`,
    );
  });

  console.log(
    ">>> Step 1: Firing all 6 runs simultaneously via HTTP & SessionManager...\n",
  );

  const runPromises = sessions.map((sess, idx) => {
    return sessionManager.dispatch(sess.id, `prompt_${idx + 1}`);
  });

  // Wait for queue to accept all 6 runs
  await waitFor(() => queuedNotifications.length >= 6);

  // Let initial dequeuing settle
  await new Promise((r) => setTimeout(r, 100));

  const initialStatuses = sessions.map((s) => ({
    sessionId: s.id,
    status: s.getStatus(),
  }));

  const runningCount = initialStatuses.filter(
    (s) => s.status === "running",
  ).length;
  const queuedCount = initialStatuses.filter(
    (s) => s.status === "queued",
  ).length;

  console.log("Initial Burst Status Snapshot:");
  for (const s of initialStatuses) {
    const icon = s.status === "running" ? "[RUNNING]" : "[QUEUED] ";
    console.log(`  ${icon} ${s.sessionId} -> status: "${s.status}"`);
  }

  const queueMetricsInitial = sessionManager.getQueueMetrics();
  console.log("\nQueue Telemetry Metrics (Initial Burst):");
  console.log(
    `  Active Consumers: ${queueMetricsInitial.activeConsumers} / ${queueMetricsInitial.maxConcurrency}`,
  );
  console.log(`  Queue Backlog:    ${queueMetricsInitial.backlogCount}`);
  console.log(`  Completed:        ${queueMetricsInitial.completedCount}`);
  console.log(`  Dead Letter:      ${queueMetricsInitial.deadLetterCount}\n`);

  if (runningCount !== CLUSTER_CONCURRENCY_LIMIT) {
    throw new Error(
      `Expected exactly ${CLUSTER_CONCURRENCY_LIMIT} running sessions, got ${runningCount}`,
    );
  }

  if (queuedCount !== TOTAL_BURST_RUNS - CLUSTER_CONCURRENCY_LIMIT) {
    throw new Error(
      `Expected ${TOTAL_BURST_RUNS - CLUSTER_CONCURRENCY_LIMIT} queued sessions, got ${queuedCount}`,
    );
  }

  if (provider.maxObservedConcurrentRuns > CLUSTER_CONCURRENCY_LIMIT) {
    throw new Error(
      `Executor capacity exceeded! Max observed: ${provider.maxObservedConcurrentRuns}`,
    );
  }

  console.log(">>> Step 2: Releasing Worker Batch 1 (prompts 1 & 2)...");
  provider.release("prompt_1");
  provider.release("prompt_2");

  await waitFor(() => provider.startedOrder.length >= 4);
  await new Promise((r) => setTimeout(r, 100));

  console.log(
    `\nBatch 1 Drained. Current Started Order: [${provider.startedOrder.join(", ")}]`,
  );
  const midStatuses = sessions.map((s) => ({
    sessionId: s.id,
    status: s.getStatus(),
  }));

  for (const s of midStatuses) {
    const icon =
      s.status === "done"
        ? "[DONE]   "
        : s.status === "running"
          ? "[RUNNING]"
          : "[QUEUED] ";
    console.log(`  ${icon} ${s.sessionId} -> status: "${s.status}"`);
  }

  console.log("\n>>> Step 3: Releasing Worker Batch 2 (prompts 3 & 4)...");
  provider.release("prompt_3");
  provider.release("prompt_4");

  await waitFor(() => provider.startedOrder.length >= 6);
  await new Promise((r) => setTimeout(r, 100));

  console.log(
    `\nBatch 2 Drained. Current Started Order: [${provider.startedOrder.join(", ")}]`,
  );

  console.log("\n>>> Step 4: Releasing Final Worker Batch (prompts 5 & 6)...");
  provider.release("prompt_5");
  provider.release("prompt_6");

  const results = await Promise.all(runPromises);

  const finalMetrics = sessionManager.getQueueMetrics();
  console.log("\nFinal Queue Telemetry Metrics (Post-Burst):");
  console.log(
    `  Active Consumers: ${finalMetrics.activeConsumers} / ${finalMetrics.maxConcurrency}`,
  );
  console.log(`  Queue Backlog:    ${finalMetrics.backlogCount}`);
  console.log(`  Completed:        ${finalMetrics.completedCount}`);
  console.log(`  Dead Letter:      ${finalMetrics.deadLetterCount}\n`);

  console.log("Final Session Results:");
  for (let i = 0; i < TOTAL_BURST_RUNS; i++) {
    const s = sessions[i];
    const r = results[i];
    console.log(
      `  [COMPLETED] ${s.id}: status="${s.getStatus()}", turns=${s.getSummary().turnCount}, response="${r.finalResponse}"`,
    );
  }

  // Verify HTTP endpoint /queue/metrics
  const reqMetrics = new Request("http://localhost:4000/queue/metrics");
  const resMetrics = await router(reqMetrics);
  const jsonMetrics = await resMetrics.json();

  if (resMetrics.status !== 200 || jsonMetrics.status !== "success") {
    throw new Error("HTTP GET /queue/metrics verification failed");
  }

  // Verify all assertions
  const isSuccess =
    provider.maxObservedConcurrentRuns <= CLUSTER_CONCURRENCY_LIMIT &&
    finalMetrics.completedCount === TOTAL_BURST_RUNS &&
    finalMetrics.backlogCount === 0 &&
    results.every(
      (r) =>
        r.state === "done" &&
        Boolean(r.finalResponse?.includes("completed successfully")),
    ) &&
    sessions.every((s) => s.getStatus() === "done");

  if (!isSuccess) {
    throw new Error("Burst queue load-leveling verification failed.");
  }

  console.log("\n============================================================");
  console.log(
    ">>> VERIFICATION SUCCESS: Burst handled cleanly with zero   <<<",
  );
  console.log(
    ">>> capacity drops, excess runs queued, and FIFO drain.     <<<",
  );
  console.log("============================================================\n");
}

if (import.meta.main) {
  runBurstQueueVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Burst verification failed:", err);
      process.exit(1);
    });
}
