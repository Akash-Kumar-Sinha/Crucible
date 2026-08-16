import { getSquadManager } from "../../squad/squad-manager";
import type { SessionManager } from "../../session/session-manager";
import type { SquadConfig, SquadStage } from "../../squad/types";

export class SquadsRouteHandler {
  private sessionManager?: SessionManager;

  constructor(sessionManager?: SessionManager) {
    this.sessionManager = sessionManager;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();
    const squadManager = getSquadManager(this.sessionManager);

    // GET /squads - List all squads
    if (path === "/squads" && method === "GET") {
      const squads = squadManager.listSquads();
      return Response.json({
        squads,
        count: squads.length,
        timestamp: Date.now(),
      });
    }

    // POST /squads - Create new squad
    if (path === "/squads" && method === "POST") {
      try {
        const body = (await req.json()) as SquadConfig;
        if (!body.name) {
          return Response.json(
            { error: { message: "Squad 'name' is required" } },
            { status: 400 },
          );
        }

        const squad = await squadManager.createSquad(body);
        return Response.json(
          {
            squad: squad.getSummary(),
            message: `Squad '${squad.name}' created successfully`,
          },
          { status: 201 },
        );
      } catch (err: any) {
        return Response.json(
          { error: { message: err.message || "Failed to create squad" } },
          { status: 400 },
        );
      }
    }

    // Match /squads/:id and subroutes
    const squadIdMatch = path.match(/^\/squads\/([^/]+)(?:\/(.*))?$/);
    if (squadIdMatch) {
      const squadId = decodeURIComponent(squadIdMatch[1]);
      const subpath = squadIdMatch[2];

      const squad = squadManager.getSquad(squadId);
      if (!squad) {
        return Response.json(
          { error: { message: `Squad '${squadId}' not found` } },
          { status: 404 },
        );
      }

      // GET /squads/:id
      if (!subpath && method === "GET") {
        return Response.json({
          squad: squad.getSummary(),
        });
      }

      // POST /squads/:id/start
      if (subpath === "start" && method === "POST") {
        try {
          const body = (await req.json()) as { goal?: string; prompt?: string };
          const goal = body.goal || body.prompt;
          if (!goal) {
            return Response.json(
              { error: { message: "Missing 'goal' or 'prompt' parameter" } },
              { status: 400 },
            );
          }

          const summary = await squad.start(goal);
          return Response.json({
            squad: summary,
            message: `Squad '${squad.name}' started successfully`,
          });
        } catch (err: any) {
          return Response.json(
            { error: { message: err.message || "Failed to start squad" } },
            { status: 500 },
          );
        }
      }

      // POST /squads/:id/transition
      if (subpath === "transition" && method === "POST") {
        try {
          const body = (await req.json()) as {
            toStage: SquadStage;
            reason: string;
            triggerRole?: any;
            targetRole?: any;
            payload?: Record<string, unknown>;
          };

          if (!body.toStage || !body.reason) {
            return Response.json(
              { error: { message: "'toStage' and 'reason' are required" } },
              { status: 400 },
            );
          }

          await squad.transition(body.toStage, {
            triggerRole: body.triggerRole,
            targetRole: body.targetRole,
            reason: body.reason,
            payload: body.payload,
          });

          return Response.json({
            squad: squad.getSummary(),
            message: `Squad transitioned to stage '${body.toStage}'`,
          });
        } catch (err: any) {
          return Response.json(
            { error: { message: err.message || "Failed to transition squad" } },
            { status: 500 },
          );
        }
      }
    }

    return Response.json(
      { error: { message: `Route not found: ${method} ${path}` } },
      { status: 404 },
    );
  }
}
