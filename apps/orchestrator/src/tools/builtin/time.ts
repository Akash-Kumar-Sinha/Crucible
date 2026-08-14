import { z } from "zod";
import type { ToolDefinition } from "../../schema/tool";

export const getCurrentTimeTool: ToolDefinition<
  Record<string, unknown>,
  { iso: string; formatted: string }
> = {
  name: "get_current_time",
  description: "Get current system date, time, and timezone information",
  parameters: z.object({}),
  execute: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      formatted: now.toLocaleString(),
    };
  },
};
