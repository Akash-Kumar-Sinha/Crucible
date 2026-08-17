import { describe, it, expect, beforeEach } from "bun:test";
import { SessionManager } from "../../session/session-manager";
import { ToolRegistry } from "../../tools/registry";
import { calculatorTool, getCurrentTimeTool } from "../../tools/builtin";
import { MockModelProvider } from "../../provider/mock";
import { ToolsRouteHandler } from "./tools";

describe("ToolsRouteHandler (GET /tools)", () => {
  let sessionManager: SessionManager;
  let handler: ToolsRouteHandler;

  beforeEach(() => {
    const tools = new ToolRegistry()
      .register(calculatorTool)
      .register(getCurrentTimeTool);

    sessionManager = new SessionManager({
      defaultProvider: new MockModelProvider(),
      defaultTools: tools,
    });
    handler = new ToolsRouteHandler(sessionManager);
  });

  it("should return list of registered tools with jsonSchema and metadata", async () => {
    const res = await handler.listTools();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.count).toBe(2);
    expect(Array.isArray(json.data)).toBe(true);

    const calc = json.data.find((t: any) => t.name === "calculator");
    expect(calc).toBeDefined();
    expect(calc.description).toContain("mathematical expression");
    expect(calc.parameters).toBeDefined();
    expect(calc.parameters.type).toBe("object");
  });

  it("should return individual tool by name on GET /tools/:name", async () => {
    const res = await handler.getTool("calculator");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.data.name).toBe("calculator");
    expect(json.data.category).toBeDefined();
  });

  it("should return 404 for unknown tool", async () => {
    const res = await handler.getTool("non_existent_tool");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.status).toBe("error");
    expect(json.error.code).toBe("TOOL_NOT_FOUND");
  });
});
