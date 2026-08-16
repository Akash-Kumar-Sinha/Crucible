import type { AgentMessage } from "../schema/envelope";
import type { ModelProvider } from "../provider/provider.interface";
import { countTextTokens } from "./token-counter";

export interface ConversationMemento {
  summary: string;
  coveredTurns: number;
  coveredMessageCount: number;
  createdTimestamp: number;
  tokenCount: number;
}

export interface SummarizerOptions {
  provider?: ModelProvider;
  model?: string;
  maxSummaryTokens?: number;
}

export class ContextSummarizer {
  private provider?: ModelProvider;
  private model?: string;
  private maxSummaryTokens: number;

  constructor(options: SummarizerOptions = {}) {
    this.provider = options.provider;
    this.model = options.model;
    this.maxSummaryTokens = options.maxSummaryTokens || 1200;
  }

  async summarizeTurns(
    messagesToSummarize: AgentMessage[],
    existingMemento?: ConversationMemento | null,
    turnCountOffset = 0,
  ): Promise<ConversationMemento> {
    if (messagesToSummarize.length === 0) {
      return (
        existingMemento || {
          summary: "",
          coveredTurns: 0,
          coveredMessageCount: 0,
          createdTimestamp: Date.now(),
          tokenCount: 0,
        }
      );
    }

    // Try model-assisted summarization if provider is available
    if (this.provider && this.provider.name !== "mock") {
      try {
        const modelSummary = await this.summarizeWithModel(
          messagesToSummarize,
          existingMemento,
        );
        if (modelSummary) {
          const totalCoveredMessages =
            (existingMemento?.coveredMessageCount || 0) +
            messagesToSummarize.length;
          const totalCoveredTurns =
            (existingMemento?.coveredTurns || 0) + turnCountOffset;

          return {
            summary: modelSummary,
            coveredTurns: Math.max(1, totalCoveredTurns),
            coveredMessageCount: totalCoveredMessages,
            createdTimestamp: Date.now(),
            tokenCount: countTextTokens(modelSummary),
          };
        }
      } catch {
        // Fall back to robust heuristic summarization
      }
    }

    return this.summarizeHeuristic(
      messagesToSummarize,
      existingMemento,
      turnCountOffset,
    );
  }

  private summarizeHeuristic(
    messages: AgentMessage[],
    existingMemento?: ConversationMemento | null,
    turnCountOffset = 0,
  ): ConversationMemento {
    let initialGoal = "";
    const keyActions: string[] = [];
    const findings: string[] = [];
    let latestAssistantOutput = "";

    for (const msg of messages) {
      if (msg.role === "user" && !initialGoal) {
        initialGoal = (msg.content || "").slice(0, 300).trim();
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            const argsStr = tc.arguments
              ? JSON.stringify(tc.arguments).slice(0, 100)
              : "";
            keyActions.push(`${tc.name}(${argsStr})`);
          }
        }
        if (msg.content) {
          latestAssistantOutput = msg.content.slice(0, 300).trim();
        }
      } else if (msg.role === "tool") {
        const preview = (msg.content || "").slice(0, 150).replace(/\n/g, " ");
        findings.push(`${msg.name || "tool"}: ${preview}`);
      }
    }

    const lines: string[] = [];
    lines.push("### Compressed Conversation Context (Older Turns)");

    if (existingMemento?.summary) {
      lines.push("**Prior Summary**:");
      lines.push(existingMemento.summary.replace(/^### [^\n]+\n/, "").trim());
      lines.push("");
    }

    if (initialGoal) {
      lines.push(`- **Goal**: ${initialGoal}`);
    }

    if (keyActions.length > 0) {
      const distinctActions = Array.from(new Set(keyActions)).slice(-6);
      lines.push(`- **Actions Executed**: ${distinctActions.join(", ")}`);
    }

    if (findings.length > 0) {
      const recentFindings = findings.slice(-4);
      lines.push(
        `- **Observations**: ${recentFindings.map((f) => `(${f})`).join("; ")}`,
      );
    }

    if (latestAssistantOutput) {
      lines.push(`- **Progress State**: ${latestAssistantOutput}`);
    }

    const finalSummary = lines.join("\n");
    const totalCoveredMessages =
      (existingMemento?.coveredMessageCount || 0) + messages.length;
    const totalCoveredTurns =
      (existingMemento?.coveredTurns || 0) + turnCountOffset;

    return {
      summary: finalSummary,
      coveredTurns: Math.max(1, totalCoveredTurns),
      coveredMessageCount: totalCoveredMessages,
      createdTimestamp: Date.now(),
      tokenCount: countTextTokens(finalSummary),
    };
  }

  private async summarizeWithModel(
    messages: AgentMessage[],
    existingMemento?: ConversationMemento | null,
  ): Promise<string | null> {
    if (!this.provider) return null;

    const transcript = messages
      .map(
        (m) =>
          `[${m.role.toUpperCase()}${m.name ? ` (${m.name})` : ""}]: ${m.content || (m.toolCalls ? JSON.stringify(m.toolCalls) : "")}`,
      )
      .join("\n");

    const prompt = `Compress the following conversation excerpt into a concise structured running summary of key goals, actions taken, tool execution results, and active progress. Limit to ${this.maxSummaryTokens} tokens.
${existingMemento?.summary ? `Existing Summary to incorporate:\n${existingMemento.summary}\n` : ""}
Conversation Excerpt:
${transcript}`;

    const response = await this.provider.complete({
      messages: [{ role: "user", content: prompt }],
      model: this.model,
      temperature: 0.1,
      maxTokens: this.maxSummaryTokens,
      systemPrompt:
        "You are an expert context compaction engine. Produce structured, factual markdown summaries preserving critical technical details.",
    });

    return response.content || null;
  }
}
