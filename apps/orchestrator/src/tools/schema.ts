import { z } from "zod";
import type { JSONSchemaObject, JSONSchemaProperty } from "./types";

/**
 * Type guard to check if an object is already a raw JSONSchemaObject
 */
export function isJsonSchemaObject(
  schema: unknown,
): schema is JSONSchemaObject {
  if (!schema || typeof schema !== "object") return false;
  return !("_def" in schema) && ("type" in schema || "properties" in schema);
}

/**
 * Converts a Zod Schema or existing JSON Schema into a normalized JSONSchemaObject
 * conforming to standard model provider and MCP tool specification requirements.
 */
export function toJsonSchema(
  schema: z.ZodType<any> | JSONSchemaObject,
): JSONSchemaObject {
  if (isJsonSchemaObject(schema)) {
    return schema;
  }
  return zodToJsonSchema(schema);
}

/**
 * Converts a Zod schema into a standard JSON Schema object.
 */
export function zodToJsonSchema(schema: z.ZodType<any>): JSONSchemaObject {
  const unwrapped = unwrapZodType(schema);

  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape;
    const properties: Record<string, JSONSchemaProperty> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodTypeAny;
      properties[key] = describeZodField(fieldSchema);

      if (!isOptionalOrNullable(fieldSchema)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  if (unwrapped instanceof z.ZodRecord) {
    return {
      type: "object",
      additionalProperties: describeZodField(unwrapped.valueSchema),
    };
  }

  return { type: "object", properties: {} };
}

function describeZodField(schema: z.ZodTypeAny): JSONSchemaProperty {
  const description = extractDescription(schema);
  const unwrapped = unwrapZodType(schema);

  if (unwrapped instanceof z.ZodString) {
    const prop: JSONSchemaProperty = { type: "string" };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodNumber) {
    const prop: JSONSchemaProperty = { type: "number" };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodBoolean) {
    const prop: JSONSchemaProperty = { type: "boolean" };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodEnum) {
    const prop: JSONSchemaProperty = {
      type: "string",
      enum: unwrapped._def.values,
    };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodLiteral) {
    const val = unwrapped.value;
    const prop: JSONSchemaProperty = {
      type: typeof val as string,
      enum: [val],
    };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodArray) {
    const prop: JSONSchemaProperty = {
      type: "array",
      items: describeZodField(unwrapped.element),
    };
    if (description) prop.description = description;
    return prop;
  }

  if (unwrapped instanceof z.ZodObject) {
    const objSchema = zodToJsonSchema(unwrapped);
    if (description) objSchema.description = description;
    return objSchema;
  }

  if (unwrapped instanceof z.ZodUnion) {
    const options = (unwrapped._def.options as z.ZodTypeAny[]).map(
      describeZodField,
    );
    const prop: JSONSchemaProperty = {
      type: options.map((o) => o.type).filter(Boolean) as string[],
    };
    if (description) prop.description = description;
    return prop;
  }

  return { type: "string", description };
}

function unwrapZodType(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodEffects ||
    current instanceof z.ZodBranded ||
    current instanceof z.ZodReadonly
  ) {
    if (current instanceof z.ZodDefault) {
      current = current._def.innerType;
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema;
    } else if ("unwrap" in current && typeof current.unwrap === "function") {
      current = current.unwrap();
    } else {
      break;
    }
  }
  return current;
}

function isOptionalOrNullable(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  );
}

function extractDescription(schema: z.ZodTypeAny): string | undefined {
  if (schema.description) return schema.description;
  if ("_def" in schema && schema._def.description) {
    return schema._def.description;
  }
  return undefined;
}
