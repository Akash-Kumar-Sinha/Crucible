import { z } from "zod";
import type { ToolDefinition } from "../../schema/tool";

export const calculatorTool: ToolDefinition<
  { expression: string },
  { result: number }
> = {
  name: "calculator",
  description:
    "Evaluate a mathematical expression safely (e.g. '2 + 2 * 10', 'Math.sqrt(144)')",
  parameters: z.object({
    expression: z.string().describe("Mathematical expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s^]/g, "");
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${sanitized});`)();
    return { result: Number(result) };
  },
};
