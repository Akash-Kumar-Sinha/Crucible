import type { ToolCall, StepRecord } from "../schema/envelope";
import type { ModelProvider } from "../provider/provider.interface";
import { OpenRouterProvider } from "../provider/openrouter";
import { ToolRegistry } from "../tools/registry";
import {
  AgentStateMachine,
  type AgentContext,
  type AgentState,
  type TransitionListener,
} from "./state-machine";
import { stepAwaitingModel, stepAwaitingTool } from "./stepper";
import { GuardrailChain, getDefaultGuardrailChain } from "../guardrails";

export interface AgentLoopOptions {
  sessionId?: string;
  provider?: ModelProvider;
  tools?: ToolRegistry;
  guardrails?: GuardrailChain;
  systemPrompt?: string;
  maxSteps?: number;
  model?: string;
  temperature?: number;
  onHumanApprovalRequired?: (
    pendingCalls: ToolCall[],
  ) => Promise<boolean | { approved: boolean; reason?: string }>;
  onStep?: (record: StepRecord) => void;
  onToken?: (delta: string) => void;
  onThought?: (thought: string) => void;
  onToolStdout?: (data: { toolCallId: string; chunk: string }) => void;
  onToolStderr?: (data: { toolCallId: string; chunk: string }) => void;
}

export interface AgentLoopResult {
  state: AgentState;
  finalResponse?: string;
  history: StepRecord[];
  context: AgentContext;
  error?: string;
}

export class AgentLoop {
  private provider: ModelProvider;
  private tools: ToolRegistry;
  private guardrails: GuardrailChain;
  private stateMachine: AgentStateMachine;
  private options: AgentLoopOptions;
  private stepListenerAttached = false;

  constructor(options: AgentLoopOptions = {}) {
    this.options = options;
    this.provider = options.provider || new OpenRouterProvider();
    this.tools = options.tools || new ToolRegistry();
    this.guardrails = options.guardrails || getDefaultGuardrailChain();
    this.stateMachine = new AgentStateMachine({
      sessionId: options.sessionId,
      systemPrompt: options.systemPrompt,
      maxSteps: options.maxSteps,
    });
  }

  getState(): AgentState {
    return this.stateMachine.getState();
  }

  getContext(): Readonly<AgentContext> {
    return this.stateMachine.getContext();
  }

  restoreMessages(messages: any[]): void {
    this.stateMachine.restoreMessages(messages);
  }

  setProvider(provider: ModelProvider): this {
    this.provider = provider;
    return this;
  }

  setTools(tools: ToolRegistry): this {
    this.tools = tools;
    return this;
  }

  reset(prompt?: string): void {
    this.stateMachine = new AgentStateMachine({
      systemPrompt: this.options.systemPrompt,
      maxSteps: this.options.maxSteps,
      initialPrompt: prompt,
    });
    this.stepListenerAttached = false;
  }

  onTransition(listener: TransitionListener): () => void {
    return this.stateMachine.onTransition(listener);
  }

  async run(prompt: string): Promise<AgentLoopResult> {
    const currentState = this.stateMachine.getState();

    // Ingest prompt into state machine
    if (
      this.stateMachine.getContext().messages.length === 0 ||
      currentState === "done" ||
      currentState === "error"
    ) {
      this.stateMachine.send({ type: "START", prompt });
    }

    // Attach step notification listener if configured and not already attached
    if (this.options.onStep && !this.stepListenerAttached) {
      this.stepListenerAttached = true;
      this.stateMachine.onTransition((_from, to, _event, ctx) => {
        if (to === "awaiting_model" || to === "done") {
          const latest = ctx.history[ctx.history.length - 1];
          if (latest) this.options.onStep?.(latest);
        }
      });
    }

    while (true) {
      const state = this.stateMachine.getState();

      if (state === "done" || state === "error") {
        const ctx = this.stateMachine.getContext();
        return {
          state,
          finalResponse: ctx.finalResponse,
          history: ctx.history,
          context: ctx,
          error: ctx.error?.message,
        };
      }

      if (state === "awaiting_human") {
        const ctx = this.stateMachine.getContext();
        if (this.options.onHumanApprovalRequired) {
          await this.handleHumanApprovalDecision(ctx.pendingHumanApprovals);
          continue;
        }

        return {
          state: "awaiting_human",
          history: ctx.history,
          context: ctx,
        };
      }

      await this.step();
    }
  }

  async resume(): Promise<AgentLoopResult> {
    while (true) {
      const state = this.stateMachine.getState();

      if (state === "done" || state === "error") {
        const ctx = this.stateMachine.getContext();
        return {
          state,
          finalResponse: ctx.finalResponse,
          history: ctx.history,
          context: ctx,
          error: ctx.error?.message,
        };
      }

      if (state === "awaiting_human") {
        const ctx = this.stateMachine.getContext();
        if (this.options.onHumanApprovalRequired) {
          await this.handleHumanApprovalDecision(ctx.pendingHumanApprovals);
          continue;
        }

        return {
          state: "awaiting_human",
          history: ctx.history,
          context: ctx,
        };
      }

      await this.step();
    }
  }

  async step(): Promise<AgentState> {
    const currentState = this.stateMachine.getState();

    switch (currentState) {
      case "awaiting_model":
        await stepAwaitingModel(this.stateMachine, this.provider, this.tools, {
          model: this.options.model,
          temperature: this.options.temperature,
          guardrails: this.guardrails,
        });
        return this.stateMachine.getState();

      case "awaiting_tool":
        await stepAwaitingTool(this.stateMachine, this.tools, {
          guardrails: this.guardrails,
          onToolStdout: this.options.onToolStdout,
          onToolStderr: this.options.onToolStderr,
        });
        return this.stateMachine.getState();

      case "awaiting_human":
      case "done":
      case "error":
        return currentState;
    }
  }

  getGuardrails(): GuardrailChain {
    return this.guardrails;
  }

  setGuardrails(guardrails: GuardrailChain): this {
    this.guardrails = guardrails;
    return this;
  }

  approve(toolCallId?: string): AgentState {
    if (this.stateMachine.getState() !== "awaiting_human") {
      throw new Error(
        `Cannot approve when in state "${this.stateMachine.getState()}". Expected "awaiting_human"`,
      );
    }
    return this.stateMachine.send({ type: "HUMAN_APPROVED", toolCallId });
  }

  reject(reason?: string, toolCallId?: string): AgentState {
    if (this.stateMachine.getState() !== "awaiting_human") {
      throw new Error(
        `Cannot reject when in state "${this.stateMachine.getState()}". Expected "awaiting_human"`,
      );
    }
    return this.stateMachine.send({
      type: "HUMAN_REJECTED",
      toolCallId,
      reason,
    });
  }

  private async handleHumanApprovalDecision(
    pendingCalls: ToolCall[],
  ): Promise<void> {
    if (!this.options.onHumanApprovalRequired) return;

    const decision = await this.options.onHumanApprovalRequired(pendingCalls);
    if (typeof decision === "boolean") {
      if (decision) {
        this.approve();
      } else {
        this.reject("User rejected the action.");
      }
    } else {
      if (decision.approved) {
        this.approve();
      } else {
        this.reject(decision.reason);
      }
    }
  }
}
