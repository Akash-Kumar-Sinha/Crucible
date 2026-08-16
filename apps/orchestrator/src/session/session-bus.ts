import { EventEmitter } from "node:events";
import {
  type InterSessionMessage,
  InterSessionMessageSchema,
} from "./inter-session-message";
import { logger } from "../observability/logger";
import { captureAgentError } from "../observability/error-reporter";

export type SessionMessageHandler = (
  message: InterSessionMessage,
) => Promise<void> | void;

export interface SessionBusMetrics {
  activeSubscribers: number;
  totalPublished: number;
  totalDelivered: number;
  totalUndeliverable: number;
  deadLetterCount: number;
}

export interface PublishResult {
  delivered: boolean;
  messageId: string;
  subject: string;
  subscribersCount: number;
  error?: string;
}

export class SessionBus extends EventEmitter {
  private subscribers: Map<string, Set<SessionMessageHandler>> = new Map(); // subject -> handlers
  private deadLetterMessages: InterSessionMessage[] = [];
  private recentMessages: InterSessionMessage[] = [];
  private totalPublished = 0;
  private totalDelivered = 0;
  private totalUndeliverable = 0;

  getSubjectForSession(sessionId: string): string {
    if (sessionId === "*" || sessionId === "sessions.*.inbox") {
      return "sessions.*.inbox";
    }
    return `sessions.${sessionId}.inbox`;
  }

  subscribe(
    sessionIdOrPattern: string,
    handler: SessionMessageHandler,
  ): () => void {
    const subject = this.getSubjectForSession(sessionIdOrPattern);
    let handlers = this.subscribers.get(subject);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(subject, handlers);
    }
    handlers.add(handler);

    return () => {
      this.unsubscribe(sessionIdOrPattern, handler);
    };
  }

  subscribeAll(handler: SessionMessageHandler): () => void {
    return this.subscribe("*", handler);
  }

  unsubscribe(
    sessionIdOrPattern: string,
    handler?: SessionMessageHandler,
  ): void {
    const subject = this.getSubjectForSession(sessionIdOrPattern);
    const handlers = this.subscribers.get(subject);
    if (!handlers) return;

    if (handler) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(subject);
      }
    } else {
      this.subscribers.delete(subject);
    }
  }

  hasSubscriber(sessionId: string): boolean {
    const subject = this.getSubjectForSession(sessionId);
    const handlers = this.subscribers.get(subject);
    return Boolean(handlers && handlers.size > 0);
  }

  async publish(rawMessage: InterSessionMessage): Promise<PublishResult> {
    const message = InterSessionMessageSchema.parse(rawMessage);
    this.totalPublished += 1;

    this.recentMessages.unshift(message);
    if (this.recentMessages.length > 200) {
      this.recentMessages.pop();
    }

    const targetSubject = this.getSubjectForSession(message.targetSessionId);
    const handlers = this.subscribers.get(targetSubject);

    const wildcardHandlers = this.subscribers.get("sessions.*.inbox");
    if (wildcardHandlers) {
      for (const wh of wildcardHandlers) {
        try {
          wh(message);
        } catch (_err) {
          // Wildcard listener errors do not impede direct delivery
        }
      }
    }

    if (!handlers || handlers.size === 0) {
      this.totalUndeliverable += 1;
      this.deadLetterMessages.push(message);
      if (this.deadLetterMessages.length > 500) {
        this.deadLetterMessages.shift();
      }

      const alertPayload = {
        alert: "UndeliverableInterSessionMessage",
        messageId: message.id,
        sourceSessionId: message.sourceSessionId,
        targetSessionId: message.targetSessionId,
        type: message.type,
        subject: targetSubject,
        tenantId: message.tenantId || "default",
        reason: `Target session '${message.targetSessionId}' has no active subscriber on subject '${targetSubject}'`,
      };

      logger.warn(alertPayload, "Undeliverable inter-session message detected");

      captureAgentError(new Error(alertPayload.reason), {
        sessionId: message.sourceSessionId,
        tenantId: message.tenantId,
        component: "SessionBus",
        alert: "UndeliverableInterSessionMessage",
        extra: alertPayload,
      });

      this.emit("undeliverableMessage", message, alertPayload);

      return {
        delivered: false,
        messageId: message.id,
        subject: targetSubject,
        subscribersCount: 0,
        error: alertPayload.reason,
      };
    }

    const deliveryPromises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(message);
        this.totalDelivered += 1;
      } catch (err: any) {
        logger.error(
          {
            err,
            messageId: message.id,
            targetSessionId: message.targetSessionId,
          },
          "Error executing inter-session message handler",
        );
      }
    });

    await Promise.all(deliveryPromises);
    this.emit("messageDelivered", message);

    return {
      delivered: true,
      messageId: message.id,
      subject: targetSubject,
      subscribersCount: handlers.size,
    };
  }

  getRecentMessages(limit = 50): InterSessionMessage[] {
    return this.recentMessages.slice(0, limit);
  }

  getDeadLetters(): InterSessionMessage[] {
    return [...this.deadLetterMessages];
  }

  getMetrics(): SessionBusMetrics {
    let activeSubscribers = 0;
    for (const set of this.subscribers.values()) {
      activeSubscribers += set.size;
    }

    return {
      activeSubscribers,
      totalPublished: this.totalPublished,
      totalDelivered: this.totalDelivered,
      totalUndeliverable: this.totalUndeliverable,
      deadLetterCount: this.deadLetterMessages.length,
    };
  }

  clear(): void {
    this.subscribers.clear();
    this.deadLetterMessages = [];
    this.recentMessages = [];
  }
}

let globalSessionBus: SessionBus | null = null;

export function getSessionBus(): SessionBus {
  if (!globalSessionBus) {
    globalSessionBus = new SessionBus();
  }
  return globalSessionBus;
}
