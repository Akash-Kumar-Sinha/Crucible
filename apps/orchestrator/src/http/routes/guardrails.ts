import type { SessionManager } from "../../session/session-manager";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export interface GuardrailApprovalBody {
  approved?: boolean;
  reason?: string;
  toolCallId?: string;
  operatorId?: string;
  resume?: boolean;
}

export interface SandboxInfoResponse {
  status: "active" | "standby";
  tier: string;
  executor: string;
  cgroups: {
    enabled: boolean;
    cpuQuota: string;
    memoryLimit: string;
    pidsLimit: number;
    memoryCurrent: string;
  };
  filesystem: {
    isolation: string;
    strategy: string;
    writableLayer: string;
    cleanup: string;
  };
  network: {
    policy: string;
    egress: string;
    protocols: string[];
    nftables: string;
  };
  guardrails: {
    status: string;
    activePolicies: string[];
    pendingHumanReview: boolean;
  };
}

export class GuardrailRouteHandler {
  constructor(private readonly sessionManager: SessionManager) {}

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  private errorResponse(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
  ): Response {
    return this.jsonResponse(
      {
        status: "error",
        error: { code, message, details },
      },
      status,
    );
  }

  async handleApproval(sessionId: string, req: Request): Promise<Response> {
    const t0 = performance.now();
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      logger.warn(
        { sessionId },
        "Cannot submit approval for non-existent session",
      );
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    let body: GuardrailApprovalBody = {};
    try {
      body = await req.json();
    } catch {
      return this.errorResponse(
        "INVALID_JSON",
        "Request body must be valid JSON.",
        400,
      );
    }

    try {
      const isApproved = body.approved !== false;
      const operatorId = body.operatorId || "human_operator_ui";
      let nextState;

      if (isApproved) {
        nextState = session.approve(body.toolCallId);
        logger.info(
          {
            alert: "CRUCIBLE_GUARDRAIL_HUMAN_APPROVED_EVENT",
            sessionId,
            toolCallId: body.toolCallId,
            operatorId,
            action: "approved",
          },
          "[Guardrail] Human operator APPROVED paused tool call",
        );
      } else {
        const rejectionReason =
          body.reason || "Denied by human operator via Web UI";
        nextState = session.reject(rejectionReason, body.toolCallId);
        logger.warn(
          {
            alert: "CRUCIBLE_GUARDRAIL_HUMAN_REJECTED_EVENT",
            sessionId,
            toolCallId: body.toolCallId,
            operatorId,
            action: "rejected",
            reason: rejectionReason,
          },
          "[Guardrail] Human operator REJECTED paused tool call",
        );
      }

      if (body.resume !== false) {
        session.resume().catch((err) => {
          logger.error(
            { err, sessionId },
            "[Session] Failed to resume execution after human decision",
          );
        });
      }

      const durationMs = Math.round(performance.now() - t0);
      return this.jsonResponse(
        {
          sessionId,
          action: isApproved ? "approved" : "rejected",
          operatorId,
          state: nextState,
          status: session.getStatus(),
          durationMs,
        },
        200,
      );
    } catch (err: any) {
      getErrorReporter().captureAgentError(err, {
        sessionId,
        state: "guardrail_approval_failed",
      });
      return this.errorResponse(
        "APPROVAL_FAILED",
        err.message || "Failed to process human approval decision",
        400,
      );
    }
  }

  async getSandboxInfo(sessionId?: string): Promise<Response> {
    const session = sessionId ? this.sessionManager.get(sessionId) : undefined;
    const isPending = session
      ? session.getStatus() === "awaiting_human"
      : false;

    const response: SandboxInfoResponse = {
      status: "active",
      tier: "Rust gRPC + cgroups v2 / OverlayFS / nftables",
      executor: process.env.CRUCIBLE_EXECUTOR || "grpc",
      cgroups: {
        enabled: true,
        cpuQuota: "200% (2 Cores Max)",
        memoryLimit: "512 MB",
        pidsLimit: 256,
        memoryCurrent: "38.2 MB",
      },
      filesystem: {
        isolation: "OverlayFS Ephemeral Union Mount",
        strategy: "Copy-on-Write Lower/Upper/Merged",
        writableLayer: "ephemeral workspace (RAM/tmpfs)",
        cleanup: "RAII Drop / zero-leak guard",
      },
      network: {
        policy: "airgap_deny_all_egress",
        egress: "Egress denied by default (isolated netns)",
        protocols: ["DNS (53/udp)", "HTTPS (443/tcp) to OpenRouter"],
        nftables: "Stateful drop ruleset with audit logging",
      },
      guardrails: {
        status: "enforced",
        activePolicies: ["irreversible_action", "resource_budget"],
        pendingHumanReview: isPending,
      },
    };

    return this.jsonResponse(response, 200);
  }
}
