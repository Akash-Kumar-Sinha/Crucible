import { z } from "zod";
import type { DeclarativeTool, ToolContext } from "./types";

export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === "object" &&
    value !== null &&
    "_def" in value &&
    typeof (value as any).parse === "function"
  );
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def;
  if (!def) return { type: "object" };

  const typeName = def.typeName;

  if (typeName === "ZodObject") {
    const shape = typeof def.shape === "function" ? def.shape() : def.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldDef = (fieldSchema as any)._def;
      const isOptional =
        fieldDef?.typeName === "ZodOptional" ||
        fieldDef?.typeName === "ZodDefault";

      if (!isOptional) {
        required.push(key);
      }

      properties[key] = zodToJsonSchema(fieldSchema as z.ZodTypeAny);
      if (def.description) {
        (properties[key] as any).description = def.description;
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (typeName === "ZodString") {
    return { type: "string", description: def.description };
  }
  if (typeName === "ZodNumber") {
    return { type: "number", description: def.description };
  }
  if (typeName === "ZodBoolean") {
    return { type: "boolean", description: def.description };
  }
  if (typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(def.type),
      description: def.description,
    };
  }
  if (typeName === "ZodEnum") {
    return {
      type: "string",
      enum: def.values,
      description: def.description,
    };
  }
  if (typeName === "ZodOptional") {
    return zodToJsonSchema(def.innerType);
  }
  if (typeName === "ZodDefault") {
    const inner = zodToJsonSchema(def.innerType);
    return {
      ...inner,
      default:
        typeof def.defaultValue === "function"
          ? def.defaultValue()
          : def.defaultValue,
    };
  }
  if (typeName === "ZodRecord") {
    return {
      type: "object",
      additionalProperties: zodToJsonSchema(def.valueType),
      description: def.description,
    };
  }

  return { type: "string" };
}

export function toolParametersToJsonSchema(
  parameters: z.ZodTypeAny | Record<string, unknown>,
): Record<string, unknown> {
  if (isZodSchema(parameters)) {
    return zodToJsonSchema(parameters);
  }
  if (typeof parameters === "object" && parameters !== null) {
    return parameters;
  }
  return { type: "object" };
}

export function defineTool<TInput = any, TOutput = any>(
  tool: DeclarativeTool<TInput, TOutput>,
): DeclarativeTool<TInput, TOutput> {
  if (!tool.name) {
    throw new Error("Tool definition requires a valid 'name' string.");
  }
  if (!tool.description) {
    throw new Error(`Tool "${tool.name}" requires a valid 'description'.`);
  }
  if (!tool.execute || typeof tool.execute !== "function") {
    throw new Error(
      `Tool "${tool.name}" requires an executable 'execute' function.`,
    );
  }

  return {
    ...tool,
    category: tool.category || "custom",
    version: tool.version || "1.0.0",
  };
}

export class ToolBuilder<TInput = any, TOutput = any> {
  private tool: Partial<DeclarativeTool<TInput, TOutput>> = {};

  private constructor(name: string) {
    this.tool.name = name;
    this.tool.category = "custom";
    this.tool.version = "1.0.0";
    this.tool.requiresApproval = false;
  }

  static named<TInput = any, TOutput = any>(
    name: string,
  ): ToolBuilder<TInput, TOutput> {
    return new ToolBuilder<TInput, TOutput>(name);
  }

  withDescription(description: string): this {
    this.tool.description = description;
    return this;
  }

  withParameters(
    parameters: z.ZodType<TInput> | Record<string, unknown>,
  ): this {
    this.tool.parameters = parameters;
    return this;
  }

  withHandler(
    execute: (
      input: TInput,
      context?: ToolContext,
    ) => Promise<TOutput> | TOutput,
  ): this {
    this.tool.execute = execute;
    return this;
  }

  requireApproval(
    required: boolean | ((input: TInput) => boolean) = true,
  ): this {
    this.tool.requiresApproval = required;
    return this;
  }

  withCategory(category: string): this {
    this.tool.category = category;
    return this;
  }

  withVersion(version: string): this {
    this.tool.version = version;
    return this;
  }

  build(): DeclarativeTool<TInput, TOutput> {
    if (!this.tool.name) {
      throw new Error("ToolBuilder: 'name' is required.");
    }
    if (!this.tool.description) {
      throw new Error(
        `ToolBuilder: 'description' is required for tool "${this.tool.name}".`,
      );
    }
    if (!this.tool.execute) {
      throw new Error(
        `ToolBuilder: 'execute' handler is required for tool "${this.tool.name}".`,
      );
    }

    return defineTool({
      name: this.tool.name,
      description: this.tool.description,
      parameters: (this.tool.parameters || z.object({})) as any,
      execute: this.tool.execute,
      requiresApproval: this.tool.requiresApproval,
      category: this.tool.category,
      version: this.tool.version,
    });
  }
}
