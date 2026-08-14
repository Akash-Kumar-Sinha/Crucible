import { spawn } from "node:child_process";
import { GrpcExecutor } from "../execution/grpc-executor";
import { performReadinessCheck } from "../observability/health";

async function verifyGrpcIpc() {
  console.log("\n=======================================================");
  console.log("⚡ CRUCIBLE IPC: TYPESCRIPT ↔ RUST GRPC VERIFICATION");
  console.log("=======================================================\n");

  const port = 50055;
  const grpcAddr = `127.0.0.1:${port}`;

  console.log(`[1] Spawning Rust gRPC Executor server on port ${port}...`);
  const rustProcess = spawn("cargo", ["run", "-p", "executor-grpc"], {
    env: { ...process.env, CRUCIBLE_GRPC_PORT: port.toString() },
    stdio: ["ignore", "pipe", "pipe"],
  });

  rustProcess.stdout?.on("data", (data) => {
    const str = data.toString().trim();
    if (str.includes("Starting Crucible Rust gRPC Executor")) {
      console.log(`[Rust Server]: ${str}`);
    }
  });

  // Wait for server to boot and bind
  const grpcExecutor = new GrpcExecutor({ address: grpcAddr });
  console.log("Waiting for gRPC client connection ready...");

  let connected = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    connected = await grpcExecutor.isAvailable();
    if (connected) break;
  }

  if (!connected) {
    rustProcess.kill("SIGKILL");
    throw new Error("Failed to connect to Rust gRPC server within 10s");
  }
  console.log("✅ [2] Connected to Rust gRPC Executor Server successfully!");

  // -------------------------------------------------------------
  // Test 1: Execute trivial command over typed gRPC
  // -------------------------------------------------------------
  console.log("\n--- TEST 1: Execute Command Over gRPC Contract ---");
  const res1 = await grpcExecutor.execute({
    command: "echo ipc_grpc_roundtrip_ok",
    sessionId: "sess_ipc_1",
    toolName: "bash_exec",
  });

  console.log(`Exit Code: ${res1.exitCode}`);
  console.log(`Stdout: "${res1.stdout}"`);
  console.log(`Duration: ${res1.durationMs}ms`);

  if (res1.exitCode !== 0 || res1.stdout !== "ipc_grpc_roundtrip_ok") {
    rustProcess.kill("SIGKILL");
    throw new Error(
      `Test 1 Failed: Expected 'ipc_grpc_roundtrip_ok' but got '${res1.stdout}'`,
    );
  }
  console.log(
    "✅ TEST 1 PASSED: TypeScript Orchestrator ↔ Rust Executor IPC succeeded!",
  );

  // -------------------------------------------------------------
  // Test 2: Environment variables, working directory & stderr capture
  // -------------------------------------------------------------
  console.log(
    "\n--- TEST 2: Environment, Working Dir & Stderr Multiplexing ---",
  );
  const res2 = await grpcExecutor.execute({
    command:
      "sh -c 'echo EnvVal: $CRUCIBLE_IPC_TEST; echo CustomErr: error_output_stream >&2'",
    env: { CRUCIBLE_IPC_TEST: "rust_grpc_streaming_123" },
    cwd: "/tmp",
  });

  console.log(`Stdout: "${res2.stdout}"`);
  console.log(`Stderr: "${res2.stderr}"`);

  if (
    !res2.stdout.includes("rust_grpc_streaming_123") ||
    !res2.stderr.includes("error_output_stream")
  ) {
    rustProcess.kill("SIGKILL");
    throw new Error(
      "Test 2 Failed: Output streams or environment variables missing.",
    );
  }
  console.log(
    "✅ TEST 2 PASSED: Output streams and environment variables preserved over gRPC!",
  );

  // -------------------------------------------------------------
  // Test 3: Timeout Enforcement via gRPC
  // -------------------------------------------------------------
  console.log("\n--- TEST 3: Timeout Enforcement Over gRPC ---");
  const res3 = await grpcExecutor.execute({
    command: "sleep 10",
    timeoutMs: 150,
  });

  console.log(`Command finished with Exit Code: ${res3.exitCode}`);
  console.log(`Stderr: "${res3.stderr}"`);
  console.log(`Timed out / killed: ${res3.killed}`);

  if (res3.exitCode !== 137 || !res3.killed) {
    rustProcess.kill("SIGKILL");
    throw new Error(
      "Test 3 Failed: Slow command did not time out as expected.",
    );
  }
  console.log(
    "✅ TEST 3 PASSED: Wall-clock timeout enforced across gRPC boundary!",
  );

  // -------------------------------------------------------------
  // Test 4: Health Check Probe with tonic-health ping
  // -------------------------------------------------------------
  console.log(
    "\n--- TEST 4: Orchestrator /readyz Health Probe Integration ---",
  );
  const healthResult = await performReadinessCheck({
    grpcAddress: grpcAddr,
    checkOpenRouter: async () => true,
    checkDisk: async () => true,
  });

  console.log(`Health Status: ${healthResult.body.status}`);
  console.log(
    "Checks:",
    JSON.stringify(healthResult.body.checks?.["rust_grpc_executor"], null, 2),
  );

  if (healthResult.body.checks?.["rust_grpc_executor"]?.status !== "ok") {
    rustProcess.kill("SIGKILL");
    throw new Error(
      "Test 4 Failed: rust_grpc_executor health check probe failed.",
    );
  }
  console.log(
    "✅ TEST 4 PASSED: Tonic-health probe verified in orchestrator readiness check!",
  );

  // Cleanup
  console.log("\nTerminating Rust gRPC server...");
  grpcExecutor.close();
  rustProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));

  console.log("\n=======================================================");
  console.log("🎉 ALL IPC TYPESCRIPT ↔ RUST GRPC VERIFICATIONS PASSED!");
  console.log("=======================================================\n");
}

verifyGrpcIpc().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
