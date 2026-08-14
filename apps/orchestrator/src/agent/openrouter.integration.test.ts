import { describe, expect, it } from "bun:test";
import { AgentLoop } from "./loop";
import { OpenRouterProvider } from "../provider/openrouter";
import { ToolRegistry, calculatorTool, getCurrentTimeTool } from "../tools";

describe("OpenRouter Free Tier Integration", () => {
  const apiKey = process.env.OPENROUTER || process.env.OPENROUTER_API_KEY;

  it("should complete an autonomous Thought-Action-Observation loop using OpenRouter free model", async () => {
    if (!apiKey) {
      console.warn(
        "Skipping live OpenRouter test: No OPENROUTER API key found in .env",
      );
      return;
    }

    const model = process.env.OPENROUTER_MODEL || "openrouter/free";

    const provider = new OpenRouterProvider({
      apiKey,
      defaultModel: model,
    });

    const tools = new ToolRegistry()
      .register(calculatorTool)
      .register(getCurrentTimeTool);

    const transitions: string[] = [];

    const loop = new AgentLoop({
      provider,
      tools,
      maxSteps: 5,
      systemPrompt:
        "You are Crucible, an AI assistant. To perform math calculations, you MUST call the `calculator` tool. Format your internal thoughts inside <thought>...</thought> tags.",
    });

    loop.onTransition((from, to, event) => {
      transitions.push(`${from} -> ${to} (${event.type})`);
    });

    console.log(`Running live OpenRouter test prompt with model '${model}'...`);
    const result = await loop.run(
      "Use the calculator tool to calculate 345 * 25. What is the answer?",
    );

    console.log("OpenRouter Test Result State:", result.state);
    if (result.error) {
      console.log("Error details:", result.error);
    }
    console.log("Transitions:", transitions);
    if (result.finalResponse) {
      console.log("Final Response:", result.finalResponse);
    }

    // Check if OpenRouter returned a daily rate limit / quota exhaustion or invalid auth in local test
    if (
      result.state === "error" &&
      result.error &&
      (result.error.includes("429") ||
        result.error.includes("401") ||
        result.error.includes("User not found") ||
        result.error.includes("Unauthorized") ||
        result.error.includes("Rate limit exceeded") ||
        result.error.includes("free-models-per-day") ||
        result.error.includes("quota"))
    ) {
      console.warn(
        `\x1b[33m[Notice] OpenRouter live model returned '${result.error}' for '${model}'. Ensure a valid OPENROUTER_API_KEY is configured in .env for live integration runs.\x1b[0m`,
      );
      expect(result.state).toBe("error");
      return;
    }

    expect(result.state).toBe("done");
    expect(result.history.length).toBeGreaterThan(0);

    // Verify tool execution occurred
    const usedCalculator = result.history.some((step) =>
      step.actions.some((a) => a.name === "calculator"),
    );
    expect(usedCalculator).toBe(true);

    // 345 * 25 = 8625
    expect(result.finalResponse).toContain("8625");
  }, 45000); // 45s timeout for free-tier LLM inference
});
