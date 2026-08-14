import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ToolRegistry } from "./registry";
import { zodToJsonSchema } from "./schema";
import {
  ENVELOPE_VERSION_V1,
  createToolCallV1,
} from "@crucible/shared-schemas";

describe("Tool Contract & Schema Transformation", () => {
  it("should convert Zod schema to standard JSON Schema Object", () => {
    const schema = z.object({
      query: z.string().describe("Search query text"),
      limit: z.number().optional().describe("Max number of results"),
      tags: z.array(z.string()).describe("Filter tags"),
      mode: z.enum(["fast", "thorough"]).default("fast"),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties?.query).toEqual({
      type: "string",
      description: "Search query text",
    });
    expect(jsonSchema.properties?.limit).toEqual({
      type: "number",
      description: "Max number of results",
    });
    expect(jsonSchema.properties?.tags).toEqual({
      type: "array",
      items: { type: "string" },
      description: "Filter tags",
    });
    expect(jsonSchema.properties?.mode).toEqual({
      type: "string",
      enum: ["fast", "thorough"],
    });
    expect(jsonSchema.required).toContain("query");
    expect(jsonSchema.required).toContain("tags");
    expect(jsonSchema.required).not.toContain("limit");
  });
});

describe("ToolRegistry Contract & Command Execution", () => {
  it("should register tools and export standard specifications (Model Declarations, MCP)", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "fetch_weather",
      description: "Fetch weather for location",
      parameters: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => ({ temp: 22, city }),
    });

    registry.registerJsonSchemaTool(
      "mcp_raw_tool",
      "Raw schema tool",
      {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      async (input) => ({ echo: input.id }),
    );

    expect(registry.has("fetch_weather")).toBe(true);
    expect(registry.has("mcp_raw_tool")).toBe(true);
    expect(registry.getAll().length).toBe(2);

    // Generic model declarations format (used by OpenRouter & LLM gateways)
    const declarations = registry.toDeclarations();
    expect(declarations.length).toBe(2);
    expect(declarations[0].type).toBe("function");
    expect(declarations[0].function.name).toBe("fetch_weather");
    expect(declarations[0].function.parameters.type).toBe("object");

    // Standard MCP format
    const mcpSpecs = registry.toMcpSpecs();
    expect(mcpSpecs.length).toBe(2);
    expect(mcpSpecs[0].name).toBe("fetch_weather");
    expect(mcpSpecs[0].inputSchema.type).toBe("object");
  });

  it("should execute a valid tool call and return a versioned ToolResultEnvelopeV1", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "add",
      description: "add two numbers",
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    const envelope = await registry.execute(
      createToolCallV1({
        callId: "call_add_1",
        toolName: "add",
        input: { a: 15, b: 27 },
      }),
      { sessionId: "sess_test", step: 1 },
    );

    expect(envelope.version).toBe(ENVELOPE_VERSION_V1);
    expect(envelope.callId).toBe("call_add_1");
    expect(envelope.toolName).toBe("add");
    expect(envelope.status).toBe("success");
    expect(envelope.output).toBe(42);
    expect(typeof envelope.durationMs).toBe("number");
  });

  it("should catch validation errors and return error envelope", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "require_number",
      description: "takes a number",
      parameters: z.object({ num: z.number() }),
      execute: async ({ num }) => num,
    });

    const envelope = await registry.execute(
      createToolCallV1({
        callId: "call_bad_params",
        toolName: "require_number",
        input: { num: "not-a-number" as any },
      }),
      { sessionId: "sess_test", step: 1 },
    );

    expect(envelope.status).toBe("error");
    expect(envelope.error?.code).toBe("INVALID_PARAMETERS");
    expect(envelope.error?.message).toContain("Expected number");
  });

  it("should return TOOL_NOT_FOUND error envelope for unregistered tool", async () => {
    const registry = new ToolRegistry();

    const envelope = await registry.execute(
      createToolCallV1({
        callId: "call_ghost",
        toolName: "ghost_tool",
        input: {},
      }),
      { sessionId: "sess_test", step: 1 },
    );

    expect(envelope.status).toBe("error");
    expect(envelope.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("should evaluate static and dynamic human approval requirements", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "static_danger",
      description: "always danger",
      parameters: z.object({}),
      requiresApproval: true,
      execute: async () => "ok",
    });

    registry.register({
      name: "dynamic_danger",
      description: "danger only on force",
      parameters: z.object({ force: z.boolean() }),
      requiresApproval: (input: { force?: boolean }) => Boolean(input.force),
      execute: async () => "ok",
    });

    expect(
      registry.requiresApproval(
        createToolCallV1({
          callId: "c1",
          toolName: "static_danger",
          input: {},
        }),
      ),
    ).toBe(true);

    expect(
      registry.requiresApproval(
        createToolCallV1({
          callId: "c2",
          toolName: "dynamic_danger",
          input: { force: false },
        }),
      ),
    ).toBe(false);

    expect(
      registry.requiresApproval(
        createToolCallV1({
          callId: "c3",
          toolName: "dynamic_danger",
          input: { force: true },
        }),
      ),
    ).toBe(true);
  });
});
