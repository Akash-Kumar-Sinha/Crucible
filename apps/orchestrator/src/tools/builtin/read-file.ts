import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ToolDefinition } from "../types";

export interface ReadFileToolOptions {
  maxBytes?: number;
  requiresApproval?: boolean;
}

export function createReadFileTool(
  options: ReadFileToolOptions = {},
): ToolDefinition<
  { path: string; encoding?: "utf-8" | "ascii" },
  { path: string; content: string; byteLength: number }
> {
  const maxBytes = options.maxBytes || 1024 * 1024; // 1MB default

  return {
    name: "read_file",
    description:
      "Read the complete UTF-8 content of a file from the local filesystem",
    parameters: z.object({
      path: z
        .string()
        .describe("Absolute or relative path to the file to read"),
      encoding: z.enum(["utf-8", "ascii"]).optional().default("utf-8"),
    }),
    requiresApproval: options.requiresApproval ?? false,
    execute: async ({ path, encoding = "utf-8" }) => {
      const data = await readFile(path, { encoding });
      const content =
        data.length > maxBytes
          ? data.substring(0, maxBytes) + "\n...[truncated]"
          : data;

      return {
        path,
        content,
        byteLength: Buffer.byteLength(content, "utf8"),
      };
    },
  };
}

export const readFileTool = createReadFileTool();
