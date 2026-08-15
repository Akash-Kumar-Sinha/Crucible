import { spawn } from "bun";

interface DemoSuiteItem {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const demos: DemoSuiteItem[] = [
  {
    name: "Tool Schema Validation & Envelope Contracts",
    command: "bun",
    args: ["apps/orchestrator/src/demo/tool-validation-demo.ts"],
  },
  {
    name: "Multi-Session Concurrency & Strict Isolation",
    command: "bun",
    args: ["apps/orchestrator/src/demo/multi-session-demo.ts"],
    env: { OPENROUTER_MODEL: "mock", CRUCIBLE_MOCK_PROVIDER: "true" },
  },
  {
    name: "Distributed Tracing (W3C TraceContext & OTel Spans)",
    command: "bun",
    args: ["apps/orchestrator/src/demo/verify-distributed-tracing.ts"],
  },
  {
    name: "End-to-End Trace Propagation & Web Metrics Dashboard",
    command: "bun",
    args: ["apps/orchestrator/src/demo/verify-e2e-trace-and-dashboard.ts"],
  },
  {
    name: "Guardrails & Policy Engine (Human Checkpoints & Resource Budgets)",
    command: "bun",
    args: ["apps/orchestrator/src/demo/verify-guardrails.ts"],
  },
  {
    name: "UI Integration: Sandbox & Guardrail Visibility (Approve/Deny & Resource Budgets)",
    command: "bun",
    args: ["apps/orchestrator/src/demo/verify-ui-visibility.ts"],
  },
  {
    name: "Rust Sandboxed Process Execution & Isolation Engine",
    command: "cargo",
    args: ["run", "-p", "executor-core", "--bin", "verify_core"],
  },
];

async function runCommand(
  demo: DemoSuiteItem,
): Promise<{ durationMs: number; success: boolean }> {
  const start = performance.now();
  try {
    const proc = Bun.spawn([demo.command, ...demo.args], {
      env: { ...process.env, ...(demo.env || {}) },
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    const durationMs = Math.round(performance.now() - start);
    return { durationMs, success: exitCode === 0 };
  } catch {
    const durationMs = Math.round(performance.now() - start);
    return { durationMs, success: false };
  }
}

async function runAllDemos() {
  console.log(
    "================================================================================",
  );
  console.log("🔥 CRUCIBLE UNIFIED SYSTEM DEMO & VERIFICATION SUITE");
  console.log(
    "================================================================================\n",
  );

  const results: Array<{ name: string; durationMs: number; success: boolean }> =
    [];

  for (let i = 0; i < demos.length; i++) {
    const demo = demos[i];
    console.log(`\n▶️ [${i + 1}/${demos.length}] Running: ${demo.name}...`);
    console.log("─".repeat(80));

    const result = await runCommand(demo);
    results.push({ name: demo.name, ...result });

    if (!result.success) {
      console.error(`❌ Demo failed: ${demo.name} (${result.durationMs}ms)`);
    } else {
      console.log(`✅ Completed: ${demo.name} in ${result.durationMs}ms`);
    }
  }

  console.log(
    "\n================================================================================",
  );
  console.log("📊 DEMO EXECUTION SUMMARY");
  console.log(
    "================================================================================\n",
  );

  let allPassed = true;
  for (const res of results) {
    const icon = res.success ? "✅ PASS" : "❌ FAIL";
    console.log(
      `  ${icon.padEnd(8)} | ${res.name.padEnd(58)} | ${res.durationMs}ms`,
    );
    if (!res.success) allPassed = false;
  }

  console.log("\n" + "=".repeat(80));
  if (allPassed) {
    console.log("🎉 ALL SYSTEM DEMOS COMPLETED SUCCESSFULLY!");
  } else {
    console.error("⚠️ SOME DEMOS FAILED. Check output above for details.");
    process.exit(1);
  }
  console.log("=".repeat(80) + "\n");
}

runAllDemos().catch((err) => {
  console.error("Unified demo runner encountered an unhandled exception:", err);
  process.exit(1);
});
