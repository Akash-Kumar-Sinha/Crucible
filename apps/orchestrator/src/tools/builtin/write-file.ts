import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../types";

export interface WriteFileToolOptions {
  requiresApproval?: boolean;
}

export function createWriteFileTool(
  options: WriteFileToolOptions = {},
): ToolDefinition<
  { path: string; content: string; overwrite?: boolean },
  { path: string; bytesWritten: number; success: boolean }
> {
  return {
    name: "write_file",
    description: "Write content to a file at the specified path on disk",
    parameters: z.object({
      path: z.string().describe("Target file path to write to"),
      content: z.string().describe("Content to write into the target file"),
      overwrite: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to overwrite if file exists"),
    }),
    requiresApproval: options.requiresApproval ?? false,
    execute: async ({ path, content }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return {
        path,
        bytesWritten: Buffer.byteLength(content, "utf-8"),
        success: true,
      };
    },
  };
}

export const writeFileTool = createWriteFileTool();
