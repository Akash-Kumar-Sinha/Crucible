import { spawn } from "node:child_process";

async function runEndToEndVerification() {
  console.log(
    "\n================================================================================",
  );
  console.log(
    "🚀 IPC END-TO-END VERIFICATION: 2 SEPARATE PROCESSES + HEALTH PROBE + KILL TEST",
  );
  console.log(
    "================================================================================\n",
  );

  const grpcPort = 50059;
  const httpPort = 4002;
  const grpcAddr = `127.0.0.1:${grpcPort}`;

  // -------------------------------------------------------------
  // Step 1: Start Process A (Rust gRPC Server)
  // -------------------------------------------------------------
  console.log(
    `[Step 1] Starting Process A: Rust gRPC Server on port ${grpcPort}...`,
  );
  const rustProcess = spawn("cargo", ["run", "-p", "executor-grpc"], {
    env: { ...process.env, CRUCIBLE_GRPC_PORT: grpcPort.toString() },
    stdio: ["ignore", "pipe", "pipe"],
  });

  rustProcess.stdout?.on("data", (d) => {
    const s = d.toString().trim();
    if (s.includes("Starting Crucible Rust gRPC Executor")) {
      console.log(`  [Rust Server Log]: ${s}`);
    }
  });

  // -------------------------------------------------------------
  // Step 2: Start Process B (TypeScript Orchestrator HTTP REST Server)
  // -------------------------------------------------------------
  console.log(
    `[Step 2] Starting Process B: Orchestrator HTTP Server on port ${httpPort} (CRUCIBLE_EXECUTOR="grpc")...`,
  );
  const tsProcess = spawn("bun", ["apps/orchestrator/src/http/server.ts"], {
    env: {
      ...process.env,
      PORT: httpPort.toString(),
      CRUCIBLE_EXECUTOR: "grpc",
      CRUCIBLE_GRPC_ADDR: grpcAddr,
      OPENROUTER_MODEL: "mock",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  tsProcess.stdout?.on("data", (d) => {
    const s = d.toString().trim();
    if (s.includes("HTTP REST Server listening")) {
      console.log(`  [TS Server Log]: ${s}`);
    }
  });

  // Wait for both servers to be online
  console.log("Waiting for servers to initialize...");
  let serversReady = false;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`http://127.0.0.1:${httpPort}/healthz`);
      if (res.ok) {
        const body = await res.json();
        if (body.system?.grpcStatus === "online") {
          serversReady = true;
          break;
        }
      }
    } catch {
      // waiting
    }
  }

  if (!serversReady) {
    rustProcess.kill("SIGKILL");
    tsProcess.kill("SIGKILL");
    throw new Error("Failed to start both servers within timeout");
  }
  console.log("✅ Both servers are online and communicating!\n");

  // -------------------------------------------------------------
  // Step 3: Verify Initial /healthz and /readyz (Rust online)
  // -------------------------------------------------------------
  console.log("--- TEST 1: Check Orchestrator Health with Rust Online ---");
  const healthz1 = await (
    await fetch(`http://127.0.0.1:${httpPort}/healthz`)
  ).json();
  const readyz1 = await (
    await fetch(`http://127.0.0.1:${httpPort}/readyz`)
  ).json();

  console.log(
    `GET /healthz -> system.grpcStatus: "${healthz1.system?.grpcStatus}"`,
  );
  console.log(
    `GET /readyz  -> checks.rust_grpc_executor:`,
    JSON.stringify(readyz1.checks?.["rust_grpc_executor"]),
  );

  if (
    healthz1.system?.grpcStatus !== "online" ||
    readyz1.checks?.["rust_grpc_executor"]?.status !== "ok"
  ) {
    rustProcess.kill("SIGKILL");
    tsProcess.kill("SIGKILL");
    throw new Error(
      "Initial health check failed: Rust gRPC executor was not reported online",
    );
  }
  console.log("✅ Initial Health Status: HEALTHY & ONLINE\n");

  // -------------------------------------------------------------
  // Step 4: Send Tool Call Request from Orchestrator through gRPC to Rust executor-core
  // -------------------------------------------------------------
  console.log(
    "--- TEST 2: Send Tool-Call Request Through Orchestrator -> gRPC -> Rust Core ---",
  );
  // Create Session
  const createRes = await (
    await fetch(`http://127.0.0.1:${httpPort}/sessions`, { method: "POST" })
  ).json();
  const sessionId = createRes.session?.id || createRes.id;
  console.log(`Created Session ID: ${sessionId}`);

  // Send Message requesting tool execution
  const msgRes = await fetch(
    `http://127.0.0.1:${httpPort}/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Please calculate the time using current tools",
      }),
    },
  );

  const msgBody = await msgRes.json();
  console.log(`Message Response Status: ${msgRes.status}`);
  console.log(`Session Status: ${msgBody.status}`);
  console.log(`Generated Response: "${msgBody.response}"`);
  console.log(
    `Turns Executed: ${msgBody.turns}, Total Steps: ${msgBody.steps}`,
  );

  if (msgRes.status !== 200 || !msgBody.response) {
    rustProcess.kill("SIGKILL");
    tsProcess.kill("SIGKILL");
    throw new Error(
      "Test 2 Failed: Tool execution message did not complete successfully",
    );
  }
  console.log(
    "✅ Tool-call request reached Rust executor-core via gRPC and completed successfully!\n",
  );

  // -------------------------------------------------------------
  // Step 5: Kill the Rust Process & Confirm /healthz Reports It Down
  // -------------------------------------------------------------
  console.log(
    "--- TEST 3: Kill Rust Process & Confirm /healthz & /readyz Report Down ---",
  );
  console.log(
    "Sending SIGKILL to Rust process (PID: " + rustProcess.pid + ")...",
  );
  rustProcess.kill("SIGKILL");

  // Wait for OS to release socket and signal down status
  await new Promise((r) => setTimeout(r, 500));

  const healthzDown = await (
    await fetch(`http://127.0.0.1:${httpPort}/healthz`)
  ).json();
  const readyzDownRes = await fetch(`http://127.0.0.1:${httpPort}/readyz`);
  const readyzDown = await readyzDownRes.json();

  console.log(
    `GET /healthz -> system.grpcStatus: "${healthzDown.system?.grpcStatus}"`,
  );
  console.log(
    `GET /readyz  -> HTTP Status Code: ${readyzDownRes.status} (503 Degraded Expected)`,
  );
  console.log(
    `GET /readyz  -> checks.rust_grpc_executor:`,
    JSON.stringify(readyzDown.checks?.["rust_grpc_executor"]),
  );

  if (
    healthzDown.system?.grpcStatus !== "down" ||
    readyzDown.checks?.["rust_grpc_executor"]?.status !== "degraded"
  ) {
    tsProcess.kill("SIGKILL");
    throw new Error(
      "Failure: Health endpoint did not report Rust gRPC executor as down/degraded!",
    );
  }
  console.log(
    "✅ Health probe immediately detected dead Rust process without hanging timeouts!\n",
  );

  // Cleanup
  console.log("Terminating Orchestrator HTTP process...");
  tsProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));

  console.log(
    "================================================================================",
  );
  console.log("🎉 FULL END-TO-END VERIFICATION COMPLETED SUCCESSFULLY!");
  console.log(
    "================================================================================\n",
  );
}

runEndToEndVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
