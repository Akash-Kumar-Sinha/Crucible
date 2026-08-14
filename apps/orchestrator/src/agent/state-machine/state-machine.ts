import type {
  AgentContext,
  AgentEvent,
  AgentState,
  TransitionListener,
} from "./types";
import type { AgentMessage } from "../../schema/envelope";
import { computeNextState } from "./transitions";

export interface StateMachineOptions {
  sessionId?: string;
  systemPrompt?: string;
  maxSteps?: number;
  initialPrompt?: string;
}

export class AgentStateMachine {
  private state: AgentState;
  private context: AgentContext;
  private listeners: TransitionListener[] = [];

  constructor(options: StateMachineOptions = {}) {
    this.context = {
      sessionId:
        options.sessionId ||
        `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      systemPrompt: options.systemPrompt,
      messages: options.initialPrompt
        ? [{ role: "user", content: options.initialPrompt }]
        : [],
      history: [],
      pendingToolCalls: [],
      pendingHumanApprovals: [],
      stepCount: 0,
      maxSteps: options.maxSteps || 25,
    };

    this.state = "awaiting_model";
  }

  getState(): AgentState {
    return this.state;
  }

  getContext(): Readonly<AgentContext> {
    return { ...this.context };
  }

  restoreMessages(messages: AgentMessage[]): void {
    this.context.messages = [...messages];
  }

  onTransition(listener: TransitionListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  send(event: AgentEvent): AgentState {
    const prevState = this.state;
    const nextState = computeNextState(this.context, prevState, event);

    this.state = nextState;

    for (const listener of this.listeners) {
      try {
        listener(prevState, nextState, event, this.context);
      } catch (err) {
        console.error("Error in state transition listener:", err);
      }
    }

    return this.state;
  }
}
