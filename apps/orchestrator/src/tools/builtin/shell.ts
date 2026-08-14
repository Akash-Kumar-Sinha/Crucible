import { z } from "zod";
import type { ToolDefinition } from "../../schema/tool";

export const dangerousShellTool: ToolDefinition<
  { command: string },
  { output: string }
> = {
  name: "dangerous_shell_exec",
  description:
    "Execute a sensitive system action (requires human confirmation)",
  parameters: z.object({
    command: z.string().describe("Command to run"),
  }),
  requiresApproval: true,
  execute: async ({ command }) => {
    return { output: `[Simulated Execution of: ${command}]` };
  },
};
