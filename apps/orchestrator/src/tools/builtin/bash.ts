import { z } from "zod";
import type { ToolDefinition } from "../types";
import { type Executor } from "../../execution/executor.interface";
import { LocalExecutor } from "../../execution/local-executor";

export interface BashToolOptions {
  executor?: Executor;
  requiresApproval?: boolean;
}

export function createBashTool(options: BashToolOptions = {}): ToolDefinition<
  { command: string; cwd?: string; timeoutMs?: number },
  { exitCode: number; stdout: string; stderr: string; durationMs: number }
> {
  const executor = options.executor || new LocalExecutor();

  return {
    name: "bash_exec",
    description:
      "Execute a shell command in the local environment and return stdout, stderr, and exitCode",
    parameters: z.object({
      command: z.string().describe("The shell command line to execute"),
      cwd: z.string().optional().describe("Optional directory to run the command in"),
      timeoutMs: z
        .number()
        .optional()
        .describe("Optional timeout in milliseconds before killing the process"),
    }),
    requiresApproval: options.requiresApproval ?? false,
    execute: async ({ command, cwd, timeoutMs }, ctx) => {
      const res = await executor.execute({
        command,
        cwd,
        timeoutMs,
        sessionId: ctx.sessionId,
      });

      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        durationMs: res.durationMs,
      };
    },
  };
}

export const bashTool = createBashTool();
