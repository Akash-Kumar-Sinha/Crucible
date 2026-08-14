import type { z } from "zod";
import type {
  ToolCallEnvelopeV1,
  ToolResultEnvelopeV1,
} from "@crucible/shared-schemas";

/**
 * Standard JSON Schema 7/Draft-2020 specification subset used by LLM providers and MCP
 */
export interface JSONSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface JSONSchemaObject extends JSONSchemaProperty {
  type?: "object";
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;
}

/**
 * Execution Context provided by the Crucible harness during tool invocation
 */
export interface ToolExecutionContext {
  sessionId: string;
  step: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

/**
 * Command Pattern: Tool Execution Handler Signature
 */
export type ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput>;

/**
 * Tool Definition Contract between a Tool and the Harness
 */
export interface ToolDefinition<
  TInput = Record<string, unknown>,
  TOutput = unknown,
> {
  name: string;
  description: string;
  parameters: z.ZodType<TInput> | JSONSchemaObject;
  requiresApproval?: boolean | ((input: TInput) => boolean);
  category?: string;
  version?: string;
  execute: ToolHandler<TInput, TOutput>;
}

/**
 * Registered Tool Record stored in the ToolRegistry
 */
export interface RegisteredTool<
  TInput = Record<string, unknown>,
  TOutput = unknown,
> {
  name: string;
  description: string;
  jsonSchema: JSONSchemaObject;
  zodSchema?: z.ZodType<TInput>;
  requiresApproval?: boolean | ((input: TInput) => boolean);
  category?: string;
  version?: string;
  handler: ToolHandler<TInput, TOutput>;
}

/**
 * Generic Tool Declaration Format used by OpenRouter and unified model gateways
 */
export interface ModelToolDeclaration {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

/**
 * Model Context Protocol (MCP) Tool Specification Format
 */
export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: JSONSchemaObject;
}
