// Schemas & Envelopes
export * from "./schema/envelope";
export * from "./schema/tool";

// Provider Strategy
export * from "./provider/provider.interface";
export * from "./provider/openrouter";

// Tool Registry & Built-in Primitives
export * from "./tools";

// State Machine & Loop
export * from "./agent/state-machine";
export * from "./agent/loop";

// Session & Multi-Session Management
export * from "./session";

// Execution Layer (Adapter Pattern)
export * from "./execution";

// HTTP REST Server (BFF API Layer)
export * from "./http";

// Observability, Health Checks & Error Reporting
export * from "./observability";

import { AgentLoop } from "./agent/loop";
import { OpenRouterProvider } from "./provider/openrouter";
import {
  ToolRegistry,
  calculatorTool,
  getCurrentTimeTool,
  dangerousShellTool,
} from "./tools";

/**
 * Example Quickstart runner for local testing
 */
async function demo() {
  console.log("=== Crucible Thought-Action-Observation Loop ===");

  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(getCurrentTimeTool)
    .register(dangerousShellTool);

  const provider = new OpenRouterProvider();

  const loop = new AgentLoop({
    provider,
    tools,
    systemPrompt:
      "You are Crucible, an advanced AI reasoning assistant. Format your internal thoughts inside <thought>...</thought> tags, then use available tools to solve user questions accurately.",
    onStep: (stepRecord) => {
      console.log(`\n--- [Step ${stepRecord.step}] ---`);
      if (stepRecord.thought) {
        console.log(`[Thought]: ${stepRecord.thought}`);
      }
      if (stepRecord.actions.length > 0) {
        console.log(
          `[Action(s)]:`,
          JSON.stringify(stepRecord.actions, null, 2),
        );
      }
      if (stepRecord.observations.length > 0) {
        console.log(
          `[Observation(s)]:`,
          JSON.stringify(stepRecord.observations, null, 2),
        );
      }
    },
    onHumanApprovalRequired: async (calls) => {
      console.log(`\n[HUMAN CONFIRMATION REQUIRED for calls]:`, calls);
      // Auto-approve for demo purposes
      return { approved: true };
    },
  });

  loop.onTransition((from, to, event) => {
    console.log(`[State Transition]: ${from} ──(${event.type})──> ${to}`);
  });

  return loop;
}

export default demo;
