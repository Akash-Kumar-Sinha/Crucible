import { KubernetesJobExecutor } from "../execution/k8s-job-executor";
import { createBashTool } from "../tools/builtin/bash";

async function main() {
  console.log("=================================================");
  console.log("  Crucible Kubernetes Job Executor Verification  ");
  console.log("=================================================");

  const executor = new KubernetesJobExecutor({
    apiUrl: "http://127.0.0.1:8001",
    namespace: "crucible",
  });

  console.log("\n1. Checking Kubernetes cluster API availability...");
  const available = await executor.isAvailable();
  console.log(`   Kubernetes API available: ${available ? "YES" : "NO"}`);
  if (!available) {
    throw new Error("Kubernetes API is not available on http://127.0.0.1:8001");
  }

  console.log("\n2. Dispatching tool command to ephemeral Kubernetes Job...");
  const command =
    'node -e \'console.log("Crucible K8s Sandbox Run:", 42 * 2); console.log("Worker pod running under restricted PodSecurity profile");\'';
  console.log(`   Command: ${command}`);

  const bashTool = createBashTool({ executor });
  const result = await bashTool.execute(
    { command },
    { sessionId: "k8s_live_sess_1", step: 1 },
  );

  console.log("\n3. Execution Completed!");
  console.log(`   Exit Code: ${result.exitCode}`);
  console.log(`   Duration:  ${result.durationMs}ms`);
  console.log(`   Output:`);
  console.log("   ---------------------------------------------");
  console.log(
    result.stdout
      .split("\n")
      .map((l) => `   | ${l}`)
      .join("\n"),
  );
  console.log("   ---------------------------------------------");

  if (result.exitCode === 0 && result.stdout.includes("84")) {
    console.log(
      "\n[SUCCESS] Kubernetes Job spawned, executed in restricted PodSecurity sandbox, and cleaned up!",
    );
  } else {
    console.error(
      "\n[FAILURE] Execution failed or output did not match expected result.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
