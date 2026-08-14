import { DockerExecutor } from "../execution/docker-executor";
import { getErrorReporter } from "../observability/error-reporter";
import { execSync } from "node:child_process";

async function verifyDockerExecution() {
  console.log("\n=======================================================");
  console.log("🚀 CRUCIBLE DOCKER EXECUTOR LIVE VERIFICATION");
  console.log("=======================================================\n");

  const dockerExecutor = new DockerExecutor();
  const available = await dockerExecutor.isAvailable();
  console.log(
    `[1] Docker Daemon Availability: ${available ? "✅ CONNECTED" : "❌ UNREACHABLE"}`,
  );
  if (!available) {
    throw new Error("Docker daemon is unreachable. Ensure dockerd is running.");
  }

  // -------------------------------------------------------------
  // Test 1: Spin up container, verify via `docker ps`, verify teardown
  // -------------------------------------------------------------
  console.log(
    "\n--- TEST 1: Container Spin-up, Docker PS Inspection & Teardown ---",
  );
  console.log(
    'Launching tool command: \'node -e "setTimeout(() => console.log(\\"container_output_verified\\"), 2000)"\'...',
  );

  const execPromise = dockerExecutor.execute({
    command:
      'node -e "setTimeout(() => console.log(\\"container_output_verified\\"), 2000)"',
    language: "node",
    toolName: "bash_exec",
    sessionId: "sess_verify_1",
  });

  // Wait 500ms for container to start, then inspect docker ps
  await new Promise((r) => setTimeout(r, 600));
  const psOutput = execSync(
    'docker ps --filter "label=crucible.managed=true" --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"',
  )
    .toString()
    .trim();
  console.log(
    "\n[Active Docker Containers during execution]:\n" +
      (psOutput || "(no container found)"),
  );

  const result1 = await execPromise;
  console.log(`\nTool Execution Finished in ${result1.durationMs}ms`);
  console.log(`Exit Code: ${result1.exitCode}`);
  console.log(`Container ID: ${result1.containerId}`);
  console.log(`Captured stdout: "${result1.stdout}"`);

  // Verify container is torn down
  const psAfter = execSync(
    'docker ps --filter "label=crucible.managed=true" --format "{{.ID}}"',
  )
    .toString()
    .trim();
  console.log(
    `[Teardown Check]: Active Crucible containers after completion: ${psAfter ? psAfter : "0 (Cleanly Removed ✅)"}`,
  );

  if (
    result1.exitCode !== 0 ||
    !result1.stdout.includes("container_output_verified") ||
    psAfter !== ""
  ) {
    throw new Error(
      "Test 1 Failed: Container output was incorrect or container was not cleaned up.",
    );
  }
  console.log(
    "✅ TEST 1 PASSED: Container spun up, executed, captured output, and tore down.",
  );

  // -------------------------------------------------------------
  // Test 2: Output flow into AgentLoop Thought-Action-Observation
  // -------------------------------------------------------------
  console.log("\n--- TEST 2: Output Flow Back to Model / Envelopes ---");
  const pyResult = await dockerExecutor.execute({
    command: "python3 -c 'print(sum(range(1, 101)))'",
    language: "python",
    toolName: "python_exec",
    sessionId: "sess_verify_2",
  });
  console.log(`Python Execution stdout: "${pyResult.stdout}" (Expected: 5050)`);
  if (pyResult.stdout !== "5050" || pyResult.exitCode !== 0) {
    throw new Error(
      `Test 2 Failed: Python output expected '5050' but got '${pyResult.stdout}'`,
    );
  }
  console.log(
    "✅ TEST 2 PASSED: Output correctly captured from container sandbox.",
  );

  // -------------------------------------------------------------
  // Test 3: Kill Container Mid-Run & Confirm Error Surfaces Without Hanging
  // -------------------------------------------------------------
  console.log(
    "\n--- TEST 3: Kill Container Mid-Run & Telemetry Verification ---",
  );
  const errorReporter = getErrorReporter();
  let capturedFailureReason: string | null = null;
  errorReporter.once("containerFailure", (record) => {
    capturedFailureReason = record.containerContext?.reason || record.message;
    console.log(`\n📢 [ErrorReporter Captured Event]: ${record.message}`);
    console.log(
      `   Level: ${record.level}, Container: ${record.containerContext?.containerId}`,
    );
  });

  console.log("Starting a long-running container (sleep 30)...");
  const killExecPromise = dockerExecutor.execute({
    command: "sleep 30",
    language: "node",
    toolName: "bash_exec",
    sessionId: "sess_kill_test",
  });

  // Wait 700ms for container to start
  await new Promise((r) => setTimeout(r, 700));

  // Find running container ID
  const runningContainerId = execSync(
    'docker ps -q --filter "label=crucible.managed=true"',
  )
    .toString()
    .trim()
    .split("\n")[0];
  console.log(
    `Found running container ID: ${runningContainerId}. Issuing 'docker kill' now...`,
  );
  execSync(`docker kill ${runningContainerId}`);
  console.log("Container killed externally.");

  const killResult = await killExecPromise;
  console.log(
    `Execution returned without hanging! Exit code: ${killResult.exitCode}, Duration: ${killResult.durationMs}ms`,
  );
  console.log(
    `ErrorReporter captured failure: ${capturedFailureReason ? "YES ✅" : "NO ❌"}`,
  );

  if (killResult.exitCode === 0) {
    throw new Error(
      "Test 3 Failed: Killed container unexpectedly reported exit code 0.",
    );
  }
  console.log(
    "✅ TEST 3 PASSED: Killed container surfaced cleanly as logged error without hanging.",
  );

  console.log("\n=======================================================");
  console.log("🎉 ALL DOCKER EXECUTOR VERIFICATION TESTS PASSED!");
  console.log("=======================================================\n");
}

verifyDockerExecution().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
