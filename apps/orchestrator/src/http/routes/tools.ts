import type { SessionManager } from "../../session/session-manager";
import { logger } from "../../observability/logger";

export class ToolsRouteHandler {
  constructor(private readonly sessionManager: SessionManager) {}

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  async listTools(): Promise<Response> {
    const t0 = performance.now();
    try {
      const toolRegistry = this.sessionManager.getDefaultTools();
      const tools = toolRegistry.getAll().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.jsonSchema,
        requiresApproval: Boolean(t.requiresApproval),
        category: t.category || "general",
        version: t.version || "1.0.0",
      }));

      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        { count: tools.length, durationMs },
        "Listed registered tools",
      );

      return this.jsonResponse({
        status: "success",
        count: tools.length,
        data: tools,
      });
    } catch (err: any) {
      logger.error({ err }, "Failed to list registered tools");
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "TOOLS_FETCH_FAILED",
            message: err.message || "Failed to retrieve registered tools",
          },
        },
        500,
      );
    }
  }

  async getTool(name: string): Promise<Response> {
    const toolRegistry = this.sessionManager.getDefaultTools();
    const tool = toolRegistry.get(name);

    if (!tool) {
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "TOOL_NOT_FOUND",
            message: `Tool '${name}' was not found in registry.`,
          },
        },
        404,
      );
    }

    return this.jsonResponse({
      status: "success",
      data: {
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
        requiresApproval: Boolean(tool.requiresApproval),
        category: tool.category || "general",
        version: tool.version || "1.0.0",
      },
    });
  }
}
