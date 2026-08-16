import { SessionManager } from "../session/session-manager";
import { ToolRegistry, calculatorTool, getCurrentTimeTool } from "../tools";
import { OpenRouterProvider } from "../provider/openrouter";
import { MockModelProvider } from "../provider/mock";

async function verifyConcurrentSessions() {
  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(getCurrentTimeTool);

  const modelEnv = process.env.OPENROUTER_MODEL || "openrouter/free";
  const provider =
    modelEnv === "mock" || process.env.CRUCIBLE_MOCK_PROVIDER === "true"
      ? new MockModelProvider()
      : new OpenRouterProvider({
          defaultModel: modelEnv,
        });

  const manager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
    defaultSystemPrompt:
      "You are Crucible. Use the calculator tool for math and the get_current_time tool for date/time. Answer concisely.",
  });

  // 1. Create 3 distinct sessions
  const sessionAlpha = await manager.createSession({
    sessionId: "session_alpha",
    title: "Math Calculation Worker",
  });

  const sessionBeta = await manager.createSession({
    sessionId: "session_beta",
    title: "Time & Date Worker",
  });

  const sessionGamma = await manager.createSession({
    sessionId: "session_gamma",
    title: "General Knowledge Worker",
  });

  // 2. Track events and transitions per session
  const sessionTraces: Record<
    string,
    { transitions: string[]; toolsUsed: string[]; thoughts: string[] }
  > = {
    session_alpha: { transitions: [], toolsUsed: [], thoughts: [] },
    session_beta: { transitions: [], toolsUsed: [], thoughts: [] },
    session_gamma: { transitions: [], toolsUsed: [], thoughts: [] },
  };

  for (const session of [sessionAlpha, sessionBeta, sessionGamma]) {
    session.on("stateChange", (to, from) => {
      sessionTraces[session.id].transitions.push(`${from} -> ${to}`);
      console.log(`[${session.id}] Transition: ${from} ──> ${to}`);
    });

    session.on("thought", (t) => {
      sessionTraces[session.id].thoughts.push(t);
      console.log(`[${session.id}] Thought: ${t}`);
    });

    session.on("action", (actions) => {
      for (const a of actions) {
        sessionTraces[session.id].toolsUsed.push(a.name);
        console.log(
          `[${session.id}] Action [Tool: ${a.name}]:`,
          JSON.stringify(a.arguments),
        );
      }
    });

    session.on("observation", (obs) => {
      for (const o of obs) {
        console.log(
          `[${session.id}] Observation [${o.name}]:`,
          JSON.stringify(o.output),
        );
      }
    });
  }

  // 3. Dispatch 3 distinct prompts concurrently
  console.log("\n[Dispatching 3 distinct messages concurrently...]");
  const [resultAlpha, resultBeta, resultGamma] = await Promise.all([
    sessionAlpha.prompt("Calculate 128 * 64 using the calculator tool."),
    sessionBeta.prompt("What is the current time using get_current_time tool?"),
    sessionGamma.prompt("What is the capital of Japan? Do not use any tools."),
  ]);

  console.log(
    "\n===============================================================",
  );
  console.log(
    "                      EXECUTION RESULTS                        ",
  );
  console.log(
    "===============================================================",
  );
  console.log(
    `[Alpha Status]: ${sessionAlpha.getStatus()} | Response: ${resultAlpha.finalResponse} | Error: ${sessionAlpha.getContext().error?.message}`,
  );
  console.log(
    `[Beta Status]:  ${sessionBeta.getStatus()} | Response: ${resultBeta.finalResponse} | Error: ${sessionBeta.getContext().error?.message}`,
  );
  console.log(
    `[Gamma Status]: ${sessionGamma.getStatus()} | Response: ${resultGamma.finalResponse} | Error: ${sessionGamma.getContext().error?.message}`,
  );

  // 4. Verify History & Message Isolation
  console.log(
    "\n===============================================================",
  );
  console.log(
    "                   ISOLATION VERIFICATION                      ",
  );
  console.log(
    "===============================================================",
  );

  const msgsAlpha = sessionAlpha.getMessages();
  const msgsBeta = sessionBeta.getMessages();
  const msgsGamma = sessionGamma.getMessages();

  console.log(`Session Alpha Message Count: ${msgsAlpha.length}`);
  console.log(`Session Beta Message Count:  ${msgsBeta.length}`);
  console.log(`Session Gamma Message Count: ${msgsGamma.length}`);

  // Alpha assertions: only math content, no time tool, no Japan query
  const alphaHasMath = msgsAlpha.some(
    (m) => m.content.includes("128 * 64") || m.content.includes("8192"),
  );
  const alphaHasTime = msgsAlpha.some(
    (m) => m.name === "get_current_time" || m.content.includes("current time"),
  );
  const alphaHasJapan = msgsAlpha.some(
    (m) => m.content.includes("Japan") || m.content.includes("Tokyo"),
  );

  // Beta assertions: only time content, no math tool, no Japan query
  const betaHasTime = msgsBeta.some(
    (m) => m.name === "get_current_time" || m.content.includes("current time"),
  );
  const betaHasMath = msgsBeta.some(
    (m) => m.name === "calculator" || m.content.includes("128 * 64"),
  );
  const betaHasJapan = msgsBeta.some(
    (m) => m.content.includes("Japan") || m.content.includes("Tokyo"),
  );

  // Gamma assertions: only Japan query, no calculator, no time tool
  const gammaHasJapan = msgsGamma.some(
    (m) => m.content.includes("Japan") || m.content.includes("Tokyo"),
  );
  const gammaHasMath = msgsGamma.some(
    (m) => m.name === "calculator" || m.content.includes("128 * 64"),
  );
  const gammaHasTime = msgsGamma.some((m) => m.name === "get_current_time");

  console.log(
    `\n- Alpha math present: ${alphaHasMath} | Zero leakage of Beta/Gamma: ${!alphaHasTime && !alphaHasJapan}`,
  );
  console.log(
    `- Beta time present: ${betaHasTime} | Zero leakage of Alpha/Gamma: ${!betaHasMath && !betaHasJapan}`,
  );
  console.log(
    `- Gamma Japan present: ${gammaHasJapan} | Zero leakage of Alpha/Beta: ${!gammaHasMath && !gammaHasTime}`,
  );

  const passed =
    alphaHasMath &&
    !alphaHasTime &&
    !alphaHasJapan &&
    betaHasTime &&
    !betaHasMath &&
    !betaHasJapan &&
    gammaHasJapan &&
    !gammaHasMath &&
    !gammaHasTime &&
    resultAlpha.state === "done" &&
    resultBeta.state === "done" &&
    resultGamma.state === "done";

  if (passed) {
    console.log(
      "\n>>> SUCCESS: All 3 sessions executed concurrently with 100% strict state isolation and zero cross-talk! <<<",
    );
    manager.clear();
    process.exit(0);
  } else {
    console.error("\n>>> FAILURE: Isolation check failed! <<<");
    manager.clear();
    process.exit(1);
  }
}

verifyConcurrentSessions().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
