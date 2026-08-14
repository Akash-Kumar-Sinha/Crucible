import {
  type ToolCallEnvelopeV1,
  type ToolResultEnvelopeV1,
  createToolErrorResultV1,
  createToolSuccessResultV1,
} from "@crucible/shared-schemas";
import { toJsonSchema, isJsonSchemaObject } from "./schema";
import type {
  JSONSchemaObject,
  McpToolSpec,
  ModelToolDeclaration,
  RegisteredTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolHandler,
} from "./types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool<any, any>>();

  /**
   * Register a tool definition adhering to the harness contract
   */
  register<TInput = any, TOutput = any>(
    tool: ToolDefinition<TInput, TOutput>,
  ): this {
    const jsonSchema = toJsonSchema(tool.parameters);
    const isZod = !isJsonSchemaObject(tool.parameters);

    const record: RegisteredTool<TInput, TOutput> = {
      name: tool.name,
      description: tool.description,
      jsonSchema,
      zodSchema: isZod ? (tool.parameters as any) : undefined,
      requiresApproval: tool.requiresApproval,
      category: tool.category,
      version: tool.version,
      handler: tool.execute,
    };

    this.tools.set(tool.name, record);
    return this;
  }

  /**
   * Register a tool directly via raw JSON Schema and handler (ideal for MCP tools)
   */
  registerJsonSchemaTool<TInput = any, TOutput = any>(
    name: string,
    description: string,
    jsonSchema: JSONSchemaObject,
    handler: ToolHandler<TInput, TOutput>,
    options: {
      requiresApproval?: boolean | ((input: TInput) => boolean);
      category?: string;
      version?: string;
    } = {},
  ): this {
    const record: RegisteredTool<TInput, TOutput> = {
      name,
      description,
      jsonSchema,
      requiresApproval: options.requiresApproval,
      category: options.category,
      version: options.version,
      handler,
    };

    this.tools.set(name, record);
    return this;
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.zodSchema || t.jsonSchema,
      requiresApproval: t.requiresApproval,
      category: t.category,
      version: t.version,
      execute: t.handler,
    }));
  }

  /**
   * Check if a given tool call requires human confirmation
   */
  requiresApproval(
    call:
      | ToolCallEnvelopeV1
      | { name: string; arguments?: unknown; input?: unknown },
  ): boolean {
    const toolName = "toolName" in call ? call.toolName : (call as any).name;
    const tool = this.tools.get(toolName);
    if (!tool || !tool.requiresApproval) return false;

    const input = "input" in call ? call.input : (call as any).arguments || {};

    if (typeof tool.requiresApproval === "function") {
      return tool.requiresApproval(input);
    }
    return Boolean(tool.requiresApproval);
  }

  /**
   * Export all registered tools as normalized declarations for model provider payloads
   */
  toDeclarations(): ModelToolDeclaration[] {
    return Array.from(this.tools.values()).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.jsonSchema,
      },
    }));
  }

  /**
   * Format all registered tools for Model Context Protocol (MCP)
   */
  toMcpSpecs(): McpToolSpec[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.jsonSchema,
    }));
  }

  /**
   * Execute a tool call command and return a versioned ToolResultEnvelopeV1
   */
  async execute(
    call:
      | ToolCallEnvelopeV1
      | {
          id: string;
          name: string;
          arguments?: Record<string, unknown>;
          input?: Record<string, unknown>;
        },
    context: ToolExecutionContext,
  ): Promise<ToolResultEnvelopeV1> {
    const startTime = Date.now();
    const callId = "callId" in call ? call.callId : call.id;
    const toolName = "toolName" in call ? call.toolName : call.name;
    const rawInput =
      "input" in call && call.input !== undefined
        ? call.input
        : (call as any).arguments || {};

    const tool = this.tools.get(toolName);

    if (!tool) {
      return createToolErrorResultV1({
        callId,
        toolName,
        message: `Tool "${toolName}" is not registered in ToolRegistry. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        code: "TOOL_NOT_FOUND",
        durationMs: Date.now() - startTime,
      });
    }

    // Input Validation: Zod schema check if available
    let validatedInput = rawInput;
    if (tool.zodSchema) {
      const parseResult = tool.zodSchema.safeParse(rawInput);
      if (!parseResult.success) {
        return createToolErrorResultV1({
          callId,
          toolName,
          message: `Invalid input parameters for tool "${toolName}": ${parseResult.error.message}`,
          code: "INVALID_PARAMETERS",
          details: parseResult.error.format(),
          durationMs: Date.now() - startTime,
        });
      }
      validatedInput = parseResult.data;
    }

    try {
      const output = await tool.handler(validatedInput, context);
      return createToolSuccessResultV1({
        callId,
        toolName,
        output,
        durationMs: Date.now() - startTime,
      });
    } catch (err: any) {
      return createToolErrorResultV1({
        callId,
        toolName,
        message: err?.message || String(err),
        code: "EXECUTION_ERROR",
        details: err,
        durationMs: Date.now() - startTime,
      });
    }
  }
}
