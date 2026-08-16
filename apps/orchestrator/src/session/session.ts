import { EventEmitter } from "node:events";
import { type AgentMessage, type StepRecord } from "../schema/envelope";
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
import { generateSessionTitle } from "./title-generator";
import { tracer } from "../observability/otel";
import {
  getSessionBus,
  type SessionBus,
  type PublishResult,
} from "./session-bus";
import {
  createInterSessionMessage,
  type InterSessionMessage,
  type InterSessionMessageType,
} from "./inter-session-message";
import { getSquadManager } from "../squad/squad-manager";

export class Session extends EventEmitter {
  readonly id: SessionId;
  title?: string;
  readonly role: string;
  readonly model: string;
  readonly tenantId: string;
  readonly namespace: string;
  readonly createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;

  private loop: AgentLoop;
  private status: SessionStatus = "idle";
  private turnCount = 0;
  private unsubscribeTransition?: () => void;
  private sessionBus: SessionBus;
  private unsubscribeBus?: () => void;

  constructor(config: SessionConfig = {}) {
    super();

    this.id =
      config.sessionId ||
      `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.title = config.title;
    this.role = config.role || (config.metadata?.role as string) || "general";
    this.model =
      config.model ||
      (config.metadata?.model as string) ||
      process.env.OPENROUTER_MODEL ||
      "openrouter/free";
    this.tenantId =
      config.tenantId ||
      (config.metadata?.tenantId as string) ||
      process.env.CRUCIBLE_TENANT_ID ||
      "default";
    this.namespace =
      config.namespace ||
      (config.metadata?.namespace as string) ||
      process.env.CRUCIBLE_NAMESPACE ||
      "crucible";
    this.createdAt = new Date();
    this.updatedAt = new Date();
    const isReadOnly = this.role === "bug_hunter";
    this.metadata = {
      ...config.metadata,
      role: this.role,
      readOnly: isReadOnly,
      model: this.model,
      tenantId: this.tenantId,
      namespace: this.namespace,
    };
    this.sessionBus = config.sessionBus || getSessionBus();
    this.unsubscribeBus = this.sessionBus.subscribe(this.id, async (msg) => {
      await this.handleIncomingInterSessionMessage(msg);
    });
    let streamedThoughtInStep = false;

    this.loop = new AgentLoop({
      sessionId: this.id,
      provider: config.provider,
      tools: config.tools,
      guardrails: config.guardrails,
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps,
      model: this.model,
      temperature: config.temperature,
      onHumanApprovalRequired: config.onHumanApprovalRequired,
      onToken: (delta) => this.emit("token", delta),
      onThought: (thought) => {
        streamedThoughtInStep = true;
        this.emit("thought", thought);
      },
      onToolStdout: (data) => this.emit("toolStdout", data),
      onToolStderr: (data) => this.emit("toolStderr", data),
      onContextUpdate: (meta) => {
        this.metadata = {
          ...this.metadata,
          contextWindow: meta,
        };
        this.emit("contextUpdate", meta);
      },
    });

    this.setupTransitionBridge(() => {
      const wasStreamed = streamedThoughtInStep;
      streamedThoughtInStep = false;
      return wasStreamed;
    });
  }

  private setupTransitionBridge(
    getAndResetStreamedThought?: () => boolean,
  ): void {
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
          const wasStreamed = getAndResetStreamedThought
            ? getAndResetStreamedThought()
            : false;
          if (!wasStreamed && event.response.thought) {
            this.emit("thought", event.response.thought);
          }
          if (event.response.toolCalls && event.response.toolCalls.length > 0) {
            this.emit("action", event.response.toolCalls);
          }
          const latestMsg = ctx.messages[ctx.messages.length - 1];
          if (latestMsg && latestMsg.role === "assistant") {
            this.emit("message", latestMsg);
          }
        } else if (event.type === "TOOL_RESULTS") {
          this.emit("observation", event.results);
          const latestStep = ctx.history[ctx.history.length - 1];
          if (latestStep) {
            this.emit("step", latestStep);
          }
          const latestMsg = ctx.messages[ctx.messages.length - 1];
          if (latestMsg && latestMsg.role === "tool") {
            this.emit("message", latestMsg);
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

  queue(jobId?: string): void {
    if (jobId) {
      this.metadata.jobId = jobId;
    }
    this.setStatus("queued");
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

  getTenantId(): string {
    return this.tenantId;
  }

  getNamespace(): string {
    return this.namespace;
  }

  getModel(): string {
    return this.model;
  }

  getRole(): string {
    return this.role;
  }

  getMetadata(): SessionMetadata {
    return {
      id: this.id,
      title: this.title,
      role: this.role,
      tenantId: this.tenantId,
      namespace: this.namespace,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      turnCount: this.turnCount,
      customMetadata: { ...this.metadata },
    };
  }

  getSummary(): SessionSummary {
    const ctx = this.loop.getContext();
    const meta = { ...this.metadata };
    try {
      const squad = getSquadManager().getSquadForSession(this.id);
      if (squad) {
        meta.squad = {
          id: squad.id,
          name: squad.name,
          stage: squad.getStage(),
          statusLine: squad.getStatusLine(),
          activeRole: squad.getSummary().activeRole,
        };
      }
    } catch (_err) {
      // SquadManager not yet initialized in isolated unit tests
    }

    return {
      id: this.id,
      title: this.title,
      role: this.role,
      tenantId: this.tenantId,
      namespace: this.namespace,
      status: this.status,
      agentState: this.loop.getState(),
      messageCount: ctx.messages.length,
      stepCount: ctx.stepCount,
      turnCount: this.turnCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: meta,
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

    if (
      !this.title ||
      this.title === "New Conversation" ||
      this.title === this.id
    ) {
      this.title = generateSessionTitle(text);
      this.metadata.title = this.title;
      this.emit("titleChange", this.title);
    }

    const userMessage: AgentMessage = { role: "user", content: text };
    this.emit("message", userMessage);

    return tracer.withSpan(
      "orchestrator.session_turn",
      {
        sessionId: this.id,
        role: this.getRole(),
        model: this.getModel(),
        turnNumber: this.turnCount,
        title: this.title,
        promptLength: text.length,
      },
      async (span) => {
        try {
          const result = await this.loop.run(text);

          this.metadata.messages = this.getMessages();
          this.metadata.title = this.title;
          this.updatedAt = new Date();

          if (result.state === "done") {
            this.setStatus("done");
            span.setAttribute("finalState", "done");
            if (result.finalResponse) {
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
            this.metadata.messages = this.getMessages();
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
          this.metadata.messages = this.getMessages();
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
      this.metadata.messages = [...data.messages];
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

  async sendToSession(
    targetSessionId: string,
    payload: {
      content?: string;
      task?: string;
      data?: Record<string, unknown>;
      type?: InterSessionMessageType;
      correlationId?: string;
    },
  ): Promise<PublishResult> {
    const msg = createInterSessionMessage({
      sourceSessionId: this.id,
      targetSessionId,
      content: payload.content,
      task: payload.task,
      data: payload.data,
      type: payload.type,
      correlationId: payload.correlationId,
      tenantId: this.tenantId,
      namespace: this.namespace,
    });

    return this.sessionBus.publish(msg);
  }

  private async handleIncomingInterSessionMessage(
    msg: InterSessionMessage,
  ): Promise<void> {
    const preview =
      msg.payload.content ||
      msg.payload.task ||
      (msg.payload.data ? JSON.stringify(msg.payload.data) : "");

    const formattedContent = `[Inter-Session Message from ${msg.sourceSessionId} (${msg.type})]: ${preview}`;
    const syntheticMessage: AgentMessage = {
      role: "system",
      content: formattedContent,
    };

    const currentMessages = this.getMessages();
    this.loop.restoreMessages([...currentMessages, syntheticMessage]);

    this.emit("interSessionMessage", msg);
    this.emit("message", syntheticMessage);
  }

  restoreMessages(messages: AgentMessage[]): void {
    this.loop.restoreMessages(messages);
  }

  dispose(): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }
    if (this.unsubscribeTransition) {
      this.unsubscribeTransition();
      this.unsubscribeTransition = undefined;
    }
    this.removeAllListeners();
  }
}
