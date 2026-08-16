import { getRoleRegistry } from "../../roles/role-registry";
import { logger } from "../../observability/logger";

export class RolesRouteHandler {
  private roleRegistry = getRoleRegistry();

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

  async listRoles(): Promise<Response> {
    const t0 = performance.now();
    try {
      const roles = this.roleRegistry.listRoles().map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        defaultModel: r.defaultModel,
        allowedTools: r.allowedTools,
        readOnly: r.readOnly,
        tagColor: r.tagColor,
        capabilities: r.capabilities,
      }));

      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        { count: roles.length, durationMs },
        "Listed available agent roles",
      );

      return this.jsonResponse({
        status: "success",
        data: roles,
      });
    } catch (err: any) {
      logger.error({ err }, "Failed to list agent roles");
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "ROLES_FETCH_FAILED",
            message: err.message || "Failed to retrieve agent roles",
          },
        },
        500,
      );
    }
  }

  async getRole(roleId: string): Promise<Response> {
    if (!this.roleRegistry.hasRole(roleId)) {
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "ROLE_NOT_FOUND",
            message: `Role '${roleId}' was not found.`,
          },
        },
        404,
      );
    }

    const role = this.roleRegistry.getRole(roleId);
    return this.jsonResponse({
      status: "success",
      data: role,
    });
  }
}
