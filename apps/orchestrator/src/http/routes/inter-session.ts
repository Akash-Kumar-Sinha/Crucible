import { getSessionBus } from "../../session/session-bus";
import { logger } from "../../observability/logger";
import { InterSessionMessageSchema } from "../../session/inter-session-message";

export class InterSessionRouteHandler {
  private sessionBus = getSessionBus();

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  async getMessages(url: URL): Promise<Response> {
    const limit = Number(url.searchParams.get("limit")) || 50;
    const messages = this.sessionBus.getRecentMessages(limit);
    const metrics = this.sessionBus.getMetrics();
    const deadLetters = this.sessionBus.getDeadLetters().slice(0, 20);

    return this.jsonResponse({
      status: "success",
      data: {
        messages,
        metrics,
        deadLetters,
      },
    });
  }

  async publishMessage(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const parsed = InterSessionMessageSchema.parse(body);
      const result = await this.sessionBus.publish(parsed);

      logger.info(
        {
          messageId: result.messageId,
          source: parsed.sourceSessionId,
          target: parsed.targetSessionId,
          delivered: result.delivered,
        },
        "Processed inter-session publish HTTP request",
      );

      return this.jsonResponse(
        {
          status: result.delivered ? "success" : "undeliverable",
          data: result,
        },
        result.delivered ? 200 : 422,
      );
    } catch (err: any) {
      logger.error({ err }, "Failed to publish inter-session message via HTTP");
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "PUBLISH_FAILED",
            message: err.message || "Failed to publish cross-session message",
          },
        },
        400,
      );
    }
  }
}
