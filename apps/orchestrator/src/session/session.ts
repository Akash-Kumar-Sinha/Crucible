import { EventEmitter } from "node:events";
import {
  type AgentMessage,
  type StepRecord,
  type ToolCall,
  type ToolResult,
} from "../schema/envelope";
import {
  type AgentContext,
  type AgentState,
} from "../agent/state-machine/types";
import { AgentLoop, type AgentLoopResult } from "../agent/loop";
import type { ModelProvider } from "../provider/provider.interface";
import type { ToolRegistry } from "../tools/registry";
import type {
  SessionConfig,
  SessionId,
  SessionMetadata,
  SessionStatus,
  SessionSummary,
} from "./types";
import { tracer } from "../observability/otel";

export class Session extends EventEmitter {
  readonly id: SessionId;
  title?: string;
  readonly createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;

  private loop: AgentLoop;
  private status: SessionStatus = "idle";
  private turnCount = 0;
  private unsubscribeTransition?: () => void;

  constructor(config: SessionConfig = {}) {
    super();

    this.id =
      config.sessionId ||
      `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.title = config.title;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = config.metadata ? { ...config.metadata } : {};

    this.loop = new AgentLoop({
      sessionId: this.id,
      provider: config.provider,
      tools: config.tools,
      guardrails: config.guardrails,
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps,
      model: config.model,
      temperature: config.temperature,
      onHumanApprovalRequired: config.onHumanApprovalRequired,
      onToken: (delta) => this.emit("token", delta),
      onThought: (thought) => this.emit("thought", thought),
      onToolStdout: (data) => this.emit("toolStdout", data),
      onToolStderr: (data) => this.emit("toolStderr", data),
    });

    this.setupTransitionBridge();
  }

  private setupTransitionBridge(): void {
    this.unsubscribeTransition = this.loop.onTransition(
      (from, to, event, ctx) => {
        this.updatedAt = new Date();
        this.emit("stateChange", to, from);

        if (to === "awaiting_human") {
          this.setStatus("awaiting_human");
          this.emit("humanApprovalRequired", ctx.pendingHumanApprovals);
        } else if (to === "done") {
          this.setStatus("done");
        } else if (to === "error") {
          this.setStatus("error");
          if (ctx.error) {
            this.emit("error", ctx.error);
          }
        } else {
          this.setStatus("running");
        }

        if (event.type === "MODEL_RESPONSE") {
          if (event.response.thought) {
            this.emit("thought", event.response.thought);
          }
          if (event.response.toolCalls && event.response.toolCalls.length > 0) {
            this.emit("action", event.response.toolCalls);
          }
        } else if (event.type === "TOOL_RESULTS") {
          this.emit("observation", event.results);
          const latestStep = ctx.history[ctx.history.length - 1];
          if (latestStep) {
            this.emit("step", latestStep);
          }
        }
      },
    );
  }

  private setStatus(newStatus: SessionStatus): void {
    if (this.status !== newStatus) {
      const prev = this.status;
      this.status = newStatus;
      this.emit("statusChange", newStatus, prev);
    }
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getState(): AgentState {
    return this.loop.getState();
  }

  getContext(): Readonly<AgentContext> {
    return this.loop.getContext();
  }

  getMessages(): AgentMessage[] {
    return [...this.loop.getContext().messages];
  }

  getHistory(): StepRecord[] {
    return [...this.loop.getContext().history];
  }

  getMetadata(): SessionMetadata {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      turnCount: this.turnCount,
      customMetadata: { ...this.metadata },
    };
  }

  getSummary(): SessionSummary {
    const ctx = this.loop.getContext();
    return {
      id: this.id,
      title: this.title,
      status: this.status,
      agentState: this.loop.getState(),
      messageCount: ctx.messages.length,
      stepCount: ctx.stepCount,
      turnCount: this.turnCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: { ...this.metadata },
    };
  }

  setProvider(provider: ModelProvider): this {
    this.loop.setProvider(provider);
    return this;
  }

  setTools(tools: ToolRegistry): this {
    this.loop.setTools(tools);
    return this;
  }

  async prompt(text: string): Promise<AgentLoopResult> {
    this.turnCount += 1;
    this.updatedAt = new Date();
    this.setStatus("running");

    const userMessage: AgentMessage = { role: "user", content: text };
    this.emit("message", userMessage);

    return tracer.withSpan(
      "orchestrator.session_turn",
      {
        sessionId: this.id,
        turnNumber: this.turnCount,
        title: this.title,
        promptLength: text.length,
      },
      async (span) => {
        try {
          const result = await this.loop.run(text);

          if (result.state === "done") {
            this.setStatus("done");
            span.setAttribute("finalState", "done");
            if (result.finalResponse) {
              const assistantMessage: AgentMessage = {
                role: "assistant",
                content: result.finalResponse,
              };
              this.emit("message", assistantMessage);
              this.emit("done", result.finalResponse, result);
            }
            this.emit("turnCompleted", {
              turnNumber: this.turnCount,
              thought: result.history[result.history.length - 1]?.thought,
              modelOutput: result.finalResponse,
              history: result.history,
            });
          } else if (result.state === "error") {
            this.setStatus("error");
            span.setAttribute("finalState", "error");
            const errorMsg =
              result.error || "Session execution encountered an error";
            const assistantErrorMessage: AgentMessage = {
              role: "assistant",
              content: `⚠️ **Execution Error**: ${errorMsg}`,
            };
            this.loop.getContext().messages.push(assistantErrorMessage);
            this.emit("message", assistantErrorMessage);
            this.emit("error", {
              message: errorMsg,
            });
            this.emit("turnCompleted", {
              turnNumber: this.turnCount,
              error: errorMsg,
              history: result.history,
            });
          } else if (result.state === "awaiting_human") {
            this.setStatus("awaiting_human");
            span.setAttribute("finalState", "awaiting_human");
          }

          return result;
        } catch (err: any) {
          this.setStatus("error");
          span.setAttribute("finalState", "error");
          const errorMsg = err?.message || String(err);
          const assistantErrorMessage: AgentMessage = {
            role: "assistant",
            content: `⚠️ **Execution Error**: ${errorMsg}`,
          };
          this.loop.getContext().messages.push(assistantErrorMessage);
          this.emit("message", assistantErrorMessage);
          const errorObj = { message: errorMsg, details: err };
          this.emit("error", errorObj);
          this.emit("turnCompleted", {
            turnNumber: this.turnCount,
            error: errorMsg,
          });
          throw err;
        }
      },
    );
  }

  restoreState(data: {
    status?: SessionStatus;
    turnCount?: number;
    messages?: AgentMessage[];
    updatedAt?: Date;
  }): void {
    if (data.status) {
      this.status = data.status;
    }
    if (data.turnCount !== undefined) {
      this.turnCount = data.turnCount;
    }
    if (data.updatedAt) {
      this.updatedAt = data.updatedAt;
    }
    if (data.messages && data.messages.length > 0) {
      this.loop.restoreMessages(data.messages);
    }
  }

  async step(): Promise<AgentState> {
    return this.loop.step();
  }

  async resume(): Promise<AgentLoopResult> {
    const result = await this.loop.resume();

    if (result.state === "done") {
      this.setStatus("done");
      if (result.finalResponse) {
        const assistantMessage: AgentMessage = {
          role: "assistant",
          content: result.finalResponse,
        };
        this.emit("message", assistantMessage);
        this.emit("done", result.finalResponse, result);
      }
      this.emit("turnCompleted", {
        turnNumber: this.turnCount,
        thought: result.history[result.history.length - 1]?.thought,
        modelOutput: result.finalResponse,
        history: result.history,
      });
    } else if (result.state === "error") {
      this.setStatus("error");
      const errorMsg = result.error || "Session execution encountered an error";
      const assistantErrorMessage: AgentMessage = {
        role: "assistant",
        content: `⚠️ **Execution Error**: ${errorMsg}`,
      };
      this.loop.getContext().messages.push(assistantErrorMessage);
      this.emit("message", assistantErrorMessage);
      this.emit("error", { message: errorMsg });
      this.emit("turnCompleted", {
        turnNumber: this.turnCount,
        error: errorMsg,
        history: result.history,
      });
    } else if (result.state === "awaiting_human") {
      this.setStatus("awaiting_human");
    }

    return result;
  }

  getGuardrails() {
    return this.loop.getGuardrails();
  }

  setGuardrails(guardrails: any) {
    this.loop.setGuardrails(guardrails);
    return this;
  }

  approve(toolCallId?: string): AgentState {
    if (this.loop.getState() === "awaiting_human") {
      const next = this.loop.approve(toolCallId);
      this.setStatus("running");
      return next;
    }
    this.setStatus("running");
    return this.loop.getState();
  }

  reject(reason?: string, toolCallId?: string): AgentState {
    if (this.loop.getState() === "awaiting_human") {
      const next = this.loop.reject(reason, toolCallId);
      this.setStatus("idle");
      return next;
    }
    this.setStatus("idle");
    return this.loop.getState();
  }

  dispose(): void {
    if (this.unsubscribeTransition) {
      this.unsubscribeTransition();
      this.unsubscribeTransition = undefined;
    }
    this.removeAllListeners();
  }
}
