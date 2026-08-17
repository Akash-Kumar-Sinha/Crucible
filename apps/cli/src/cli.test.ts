import { describe, it, expect } from "bun:test";
import { parseCliArgs, main } from "./cli";
import { formatTable, stripAnsi, badge } from "./formatters";
import { runDoctorCommand } from "./commands/doctor";
import { runToolsListCommand } from "./commands/tools-list";
import { runSandboxLogsCommand } from "./commands/sandbox-logs";

describe("Crucible Developer CLI", () => {
  describe("Argument Parser (parseCliArgs)", () => {
    it("should parse positional command and arguments", () => {
      const parsed = parseCliArgs([
        "run",
        "Build a calculator",
        "--role",
        "coder",
      ]);
      expect(parsed.command).toBe("run");
      expect(parsed.positional).toEqual(["Build a calculator"]);
      expect(parsed.flags["role"]).toBe("coder");
    });

    it("should parse boolean flags and short flags", () => {
      const parsed = parseCliArgs([
        "doctor",
        "--json",
        "-v",
        "-e",
        "http://localhost:4000",
      ]);
      expect(parsed.command).toBe("doctor");
      expect(parsed.flags["json"]).toBe(true);
      expect(parsed.flags["v"]).toBe(true);
      expect(parsed.flags["e"]).toBe("http://localhost:4000");
    });

    it("should parse flags with equal signs", () => {
      const parsed = parseCliArgs([
        "tools-list",
        "--endpoint=http://127.0.0.1:4000",
        "--category=math",
      ]);
      expect(parsed.command).toBe("tools-list");
      expect(parsed.flags["endpoint"]).toBe("http://127.0.0.1:4000");
      expect(parsed.flags["category"]).toBe("math");
    });
  });

  describe("Terminal Formatters", () => {
    it("should strip ANSI codes correctly", () => {
      const colored = "\x1b[32m\x1b[1m[OK]\x1b[0m Nominal";
      expect(stripAnsi(colored)).toBe("[OK] Nominal");
    });

    it("should generate formatted table with headers and borders", () => {
      const headers = ["Tool", "Status"];
      const rows = [
        ["calculator", badge("OK", "ok")],
        ["bash_exec", badge("WARN", "warn")],
      ];
      const table = formatTable(headers, rows);
      expect(table).toContain("Tool");
      expect(table).toContain("Status");
      expect(table).toContain("calculator");
      expect(table).toContain("bash_exec");
    });
  });

  describe("Doctor CLI Command (crucible doctor)", () => {
    it("should run diagnostics in json mode with mock server", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.endsWith("/healthz")) {
          return new Response(
            JSON.stringify({ status: "healthy", uptime: 100 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/readyz")) {
          return new Response(
            JSON.stringify({
              status: "healthy",
              checks: {
                orchestrator_loop: { status: "ok", latencyMs: 1 },
                openrouter_gateway: { status: "ok", latencyMs: 30 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await runDoctorCommand({
          endpoint: "http://mock.crucible.local",
          json: true,
        });
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Tools List CLI Command (crucible tools-list)", () => {
    it("should list registered tools in JSON format", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.endsWith("/tools")) {
          return new Response(
            JSON.stringify({
              status: "success",
              count: 2,
              data: [
                {
                  name: "calculator",
                  description: "Math evaluation",
                  parameters: { type: "object" },
                  requiresApproval: false,
                  category: "math",
                  version: "1.0.0",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await runToolsListCommand({
          endpoint: "http://mock.crucible.local",
          json: true,
        });
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Sandbox Logs CLI Command (crucible sandbox-logs)", () => {
    it("should retrieve sandbox logs in JSON format", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes("/sessions/sess_test_123")) {
          return new Response(
            JSON.stringify({
              id: "sess_test_123",
              title: "Test Session",
              status: "done",
              messages: [{ role: "user", content: "hi" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/sandbox")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                cgroups: { cpuMax: "2.0", memoryMax: "512MB" },
                network: { airgap: true },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/infra-status")) {
          return new Response(JSON.stringify({ status: "success", data: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await runSandboxLogsCommand("sess_test_123", {
          endpoint: "http://mock.crucible.local",
          json: true,
        });
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("CLI Dispatcher (main)", () => {
    it("should print version on --version", async () => {
      const exitCode = await main(["--version"]);
      expect(exitCode).toBe(0);
    });

    it("should print help on --help", async () => {
      const exitCode = await main(["--help"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("CLI Feature Parity Commands", () => {
    it("should dispatch session-create in json mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.endsWith("/sessions")) {
          return new Response(
            JSON.stringify({
              id: "sess_cli_create_1",
              title: "CLI Session",
              role: "bug_hunter",
              model: "anthropic/claude-3.5-sonnet",
              status: "idle",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await main([
          "session-create",
          "--role",
          "bug_hunter",
          "--model",
          "anthropic/claude-3.5-sonnet",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should dispatch session-send prompt in json mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes("/sessions/sess_123/prompt")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                sessionId: "sess_123",
                response: "Done",
                status: "completed",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await main([
          "session-send",
          "sess_123",
          "Fix memory leak",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should dispatch context-usage in json mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes("/sessions/sess_ctx")) {
          return new Response(
            JSON.stringify({
              id: "sess_ctx",
              status: "idle",
              messages: [],
              metadata: {
                contextWindow: {
                  totalTokens: 12000,
                  limit: 128000,
                  usagePercent: 9,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await main([
          "context-usage",
          "sess_ctx",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should dispatch audit-tail and audit-verify in json mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes("/audit/records")) {
          return new Response(
            JSON.stringify({
              total: 1,
              records: [
                { sequence: 1, action: "read_file", checksum: "hash123" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/audit/verify")) {
          return new Response(
            JSON.stringify({
              status: "success",
              integrity: { valid: true, totalRecords: 1 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCodeTail = await main([
          "audit-tail",
          "sess_1",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCodeTail).toBe(0);

        const exitCodeVerify = await main([
          "audit-verify",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCodeVerify).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should dispatch metrics in json mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        if (url.includes("/metrics")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                tokens: { totalTokens: 5000 },
                queue: { activeConsumers: 4 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      try {
        const exitCode = await main([
          "metrics",
          "--endpoint",
          "http://mock.crucible.local",
          "--json",
        ]);
        expect(exitCode).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
