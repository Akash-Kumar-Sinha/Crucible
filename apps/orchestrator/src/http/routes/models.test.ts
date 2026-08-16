import { describe, it, expect } from "bun:test";
import { ModelsRouteHandler } from "./models";

describe("ModelsRouteHandler (GET /models)", () => {
  it("should return list of available models with context length and provider metadata", async () => {
    const handler = new ModelsRouteHandler();
    const response = await handler.listModels();

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.status).toBe("success");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const first = body.data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("contextLength");
    expect(first).toHaveProperty("isFree");
    expect(first).toHaveProperty("provider");
  });
});
