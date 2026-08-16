import { OpenRouterProvider } from "../../provider/openrouter";
import { logger } from "../../observability/logger";

export class ModelsRouteHandler {
  private openrouter = new OpenRouterProvider();

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

  async listModels(): Promise<Response> {
    const t0 = performance.now();
    try {
      const models = await this.openrouter.listAvailableModels();
      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        { count: models.length, durationMs },
        "Listed available model profiles",
      );

      return this.jsonResponse({
        status: "success",
        data: models,
      });
    } catch (err: any) {
      logger.error({ err }, "Failed to fetch model catalog from provider");
      return this.jsonResponse(
        {
          status: "error",
          error: {
            code: "MODELS_FETCH_FAILED",
            message: err.message || "Failed to retrieve available models",
          },
        },
        500,
      );
    }
  }
}
