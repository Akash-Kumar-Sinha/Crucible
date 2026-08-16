import { describe, it, expect, beforeEach } from "bun:test";
import {
  countTextTokens,
  countMessageTokens,
  getModelContextProfile,
} from "./token-counter";
import { ContextSummarizer } from "./summarizer";
import {
  ContextWindowManager,
  SlidingWindowStrategy,
  SummarizationStrategy,
} from "./context-window-manager";
import type { AgentMessage } from "../schema/envelope";

describe("Context Window Management & Token Counting Subsystem", () => {
  describe("TokenCounter & Model Context Limits", () => {
    it("should accurately count text tokens across strings, code, and whitespace", () => {
      expect(countTextTokens("")).toBe(0);
      expect(countTextTokens("Hello world")).toBeGreaterThanOrEqual(2);

      const codeSnippet = `
function calculateFibonacci(n: number): number {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}
`;
      const tokenCount = countTextTokens(codeSnippet);
      expect(tokenCount).toBeGreaterThan(15);
      expect(tokenCount).toBeLessThan(100);
    });

    it("should calculate message tokens including role framing, thought, and tool calls", () => {
      const message: AgentMessage = {
        role: "assistant",
        thought: "I need to inspect the directory contents.",
        content: "Here are the files in the directory:",
        toolCalls: [
          {
            id: "call_123",
            name: "bash_exec",
            arguments: { command: "ls -la /workspace" },
          },
        ],
      };

      const tokens = countMessageTokens(message);
      expect(tokens).toBeGreaterThan(20);
    });

    it("should resolve correct model context profiles and safety thresholds", () => {
      const claudeProfile = getModelContextProfile(
        "anthropic/claude-3.5-sonnet",
      );
      expect(claudeProfile.contextWindow).toBe(200000);
      expect(claudeProfile.safeThresholdPercent).toBe(0.8);

      const gpt4oProfile = getModelContextProfile("openai/gpt-4o");
      expect(gpt4oProfile.contextWindow).toBe(128000);

      const geminiProfile = getModelContextProfile(
        "google/gemini-2.0-flash-001",
      );
      expect(geminiProfile.contextWindow).toBe(1048576);

      const defaultProfile = getModelContextProfile("unknown-custom-model");
      expect(defaultProfile.contextWindow).toBe(65536);
    });
  });

  describe("ContextSummarizer (Memento Pattern)", () => {
    it("should produce a structured memento snapshot from conversation turns", async () => {
      const summarizer = new ContextSummarizer();
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: "Optimize the database query in user-service",
        },
        {
          role: "assistant",
          content: "I will check the SQL schema first.",
          toolCalls: [
            {
              id: "tc_1",
              name: "read_file",
              arguments: { path: "schema.sql" },
            },
          ],
        },
        {
          role: "tool",
          name: "read_file",
          toolCallId: "tc_1",
          content:
            "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE);",
        },
      ];

      const memento = await summarizer.summarizeTurns(messages);
      expect(memento.coveredTurns).toBeGreaterThanOrEqual(1);
      expect(memento.coveredMessageCount).toBe(3);
      expect(memento.summary).toContain("Compressed Conversation Context");
      expect(memento.summary).toContain("Optimize the database query");
      expect(memento.summary).toContain("read_file");
      expect(memento.tokenCount).toBeGreaterThan(10);
    });
  });

  describe("ContextWindowManager (Strategy Pattern & Compaction)", () => {
    let manager: ContextWindowManager;

    beforeEach(() => {
      manager = new ContextWindowManager({
        compactionAlertThreshold: 2,
        compactionAlertWindowMs: 10000,
      });
    });

    it("should keep messages unchanged when within safe budget", async () => {
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi! How can I help you today?" },
      ];

      const prepared = await manager.prepareMessages(messages, {
        model: "openai/gpt-4o",
        sessionId: "sess_test_1",
      });

      expect(prepared.messages.length).toBe(2);
      expect(prepared.metadata.isSummarized).toBe(false);
      expect(prepared.metadata.totalTokens).toBeGreaterThan(0);
      expect(prepared.metadata.limit).toBe(128000);
    });

    it("should apply SlidingWindowStrategy keeping initial user prompt and recent window", async () => {
      const slidingStrategy = new SlidingWindowStrategy();
      const profile = getModelContextProfile("openrouter/free"); // 32k window
      const summarizer = new ContextSummarizer();

      const messages: AgentMessage[] = [
        { role: "user", content: "Initial Task: Build an auth service" },
        { role: "assistant", content: "Step 1 done" },
        { role: "user", content: "Next step" },
        { role: "assistant", content: "Step 2 done" },
        { role: "user", content: "Next step 3" },
        { role: "assistant", content: "Step 3 done" },
      ];

      const result = await slidingStrategy.process(
        messages,
        profile,
        summarizer,
        { systemPrompt: "You are a helpful assistant." },
      );

      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      expect(result.messages[0].content).toContain("Initial Task");
    });

    it("should apply SummarizationStrategy replacing older turns with structured Memento", async () => {
      const summarizationStrategy = new SummarizationStrategy();
      const profile = getModelContextProfile("default");
      const summarizer = new ContextSummarizer();

      const messages: AgentMessage[] = [
        { role: "user", content: "Task: Deploy Kubernetes cluster" },
        { role: "assistant", content: "Initializing manifests" },
        { role: "user", content: "Apply resource quotas" },
        { role: "assistant", content: "Resource quotas applied" },
        { role: "user", content: "Verify cluster status" },
        { role: "assistant", content: "Cluster is healthy" },
      ];

      const result = await summarizationStrategy.process(
        messages,
        profile,
        summarizer,
        {},
      );

      expect(result.isSummarized).toBe(true);
      expect(result.memento).toBeDefined();
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toContain(
        "Compressed Conversation Context",
      );
    });

    it("should apply HybridStrategy retaining initial goal, running summary, and recent messages", async () => {
      const messages: AgentMessage[] = [];
      for (let i = 1; i <= 12; i++) {
        messages.push({ role: "user", content: `Turn ${i} user instruction` });
        messages.push({
          role: "assistant",
          content: `Turn ${i} assistant execution output`,
        });
      }

      const prepared = await manager.prepareMessages(messages, {
        model: "openai/gpt-4o",
        sessionId: "sess_hybrid_1",
      });

      expect(prepared.metadata.isSummarized).toBe(true);
      expect(prepared.metadata.summarizedTurnCount).toBeGreaterThan(0);
      expect(prepared.messages[0].role).toBe("system");
      expect(prepared.messages[0].content).toContain(
        "Compressed Conversation Context",
      );
      expect(prepared.messages.length).toBeLessThan(messages.length);
    });

    it("should emit compaction overflow alert when compaction occurs repeatedly in a short window", async () => {
      let alertEmitted = false;
      manager.on("compaction_overflow_alert", (payload) => {
        alertEmitted = true;
        expect(payload.alert).toBe("RepeatedContextCompaction");
        expect(payload.sessionId).toBe("sess_alert_test");
      });

      const messages: AgentMessage[] = [];
      for (let i = 1; i <= 14; i++) {
        messages.push({ role: "user", content: `Turn ${i} prompt` });
        messages.push({ role: "assistant", content: `Turn ${i} output` });
      }

      // Trigger multiple preparations
      await manager.prepareMessages(messages, {
        model: "openrouter/free",
        sessionId: "sess_alert_test",
      });

      await manager.prepareMessages(messages, {
        model: "openrouter/free",
        sessionId: "sess_alert_test",
      });

      expect(alertEmitted).toBe(true);
    });
  });
});
