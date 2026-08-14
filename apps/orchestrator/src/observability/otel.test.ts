import { describe, it, expect, beforeEach } from "bun:test";
import {
  tracer,
  spanCollector,
  parseTraceparent,
  formatTraceparent,
  generateHex,
} from "./otel";
import { getErrorReporter } from "./error-reporter";

describe("OpenTelemetry & Distributed Tracing (otel.ts)", () => {
  beforeEach(() => {
    spanCollector.clear();
  });

  describe("W3C TraceContext Specification", () => {
    it("should generate valid random hex strings", () => {
      const traceId = generateHex(16);
      const spanId = generateHex(8);

      expect(traceId).toHaveLength(32);
      expect(spanId).toHaveLength(16);
      expect(/^[0-9a-f]{32}$/.test(traceId)).toBe(true);
      expect(/^[0-9a-f]{16}$/.test(spanId)).toBe(true);
    });

    it("should format and parse W3C traceparent headers", () => {
      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const spanId = "00f067aa0ba902b7";

      const header = formatTraceparent(traceId, spanId, true);
      expect(header).toBe(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      );

      const parsed = parseTraceparent(header);
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe(traceId);
      expect(parsed?.parentSpanId).toBe(spanId);
      expect(parsed?.sampled).toBe(true);
    });

    it("should return null for invalid traceparent headers", () => {
      expect(parseTraceparent("invalid")).toBeNull();
      expect(parseTraceparent("01-too-short-01")).toBeNull();
      expect(parseTraceparent("00-invalidlen-invalidlen-01")).toBeNull();
    });
  });

  describe("Span Creation & Context Propagation", () => {
    it("should create spans and propagate context across nested calls", async () => {
      await tracer.withSpan(
        "root.session_turn",
        { sessionId: "sess_test_101" },
        async (rootSpan) => {
          expect(rootSpan.name).toBe("root.session_turn");
          expect(rootSpan.traceId).toBeDefined();

          await tracer.withSpan(
            "child.model_turn",
            { model: "mock-model" },
            async (childSpan) => {
              expect(childSpan.name).toBe("child.model_turn");
              expect(childSpan.traceId).toBe(rootSpan.traceId);
              expect(childSpan.parentSpanId).toBe(rootSpan.id);

              await tracer.withSpan(
                "tool.bash_exec",
                { command: "echo test" },
                async (toolSpan) => {
                  expect(toolSpan.traceId).toBe(rootSpan.traceId);
                  expect(toolSpan.parentSpanId).toBe(childSpan.id);
                },
              );
            },
          );
        },
      );

      const spans = spanCollector.getSpans({ sessionId: "sess_test_101" });
      expect(spans.length).toBe(3);
      const allSpans = spanCollector.getSpans();
      expect(allSpans.length).toBe(3);
    });

    it("should record error status when wrapped function throws", async () => {
      let threw = false;
      try {
        await tracer.withSpan(
          "failing.operation",
          { sessionId: "sess_fail_1" },
          async () => {
            throw new Error("Synthetic database outage");
          },
        );
      } catch (err: any) {
        threw = true;
        expect(err.message).toBe("Synthetic database outage");
      }

      expect(threw).toBe(true);

      const spans = spanCollector.getSpans({ sessionId: "sess_fail_1" });
      expect(spans.length).toBe(1);
      expect(spans[0].status).toBe("ERROR");
      expect(spans[0].errorMessage).toBe("Synthetic database outage");
    });
  });

  describe("SpanCollector Metrics Aggregation", () => {
    it("should aggregate per-session latency percentiles and tool error rates", async () => {
      await tracer.withSpan(
        "tool.calc",
        { sessionId: "sess_metrics_1", toolName: "calc" },
        async () => {
          await new Promise((r) => setTimeout(r, 15));
        },
      );

      await tracer.withSpan(
        "tool.bash",
        { sessionId: "sess_metrics_1", toolName: "bash", exitCode: 0 },
        async () => {
          await new Promise((r) => setTimeout(r, 25));
        },
      );

      try {
        await tracer.withSpan(
          "tool.fail",
          { sessionId: "sess_metrics_1", toolName: "failing_tool" },
          async () => {
            throw new Error("Command failed with exitCode 1");
          },
        );
      } catch {
        // expected test error
      }

      const metrics = spanCollector.getPerSessionMetrics("sess_metrics_1");
      const sessMetrics = metrics["sess_metrics_1"];

      expect(sessMetrics).toBeDefined();
      expect(sessMetrics.traceCount).toBe(3);
      expect(sessMetrics.toolCallsTotal).toBe(3);
      expect(sessMetrics.toolCallsFailed).toBe(1);
      expect(sessMetrics.toolErrorRate).toBeCloseTo(33.33, 1);
      expect(sessMetrics.meanLatencyMs).toBeGreaterThan(0);
      expect(sessMetrics.p95LatencyMs).toBeGreaterThan(0);
    });

    it("should return complete system metrics summary", () => {
      const summary = spanCollector.getSystemSummary();
      expect(summary.timestamp).toBeDefined();
      expect(summary.activeTraceCount).toBe(0);
      expect(summary.totalSpansRecorded).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Trace-Correlated Error Reporting", () => {
    it("should automatically correlate captured errors with the active OTel traceId and spanId", async () => {
      const reporter = getErrorReporter();

      await tracer.withSpan(
        "orchestrator.guarded_turn",
        { sessionId: "sess_err_corr" },
        async (activeSpan) => {
          const errorId = reporter.captureAgentError(
            new Error("Sandbox container OOM incident"),
            { sessionId: "sess_err_corr" },
          );

          expect(errorId).toBeDefined();
          const recent = reporter.getRecentErrors();
          const lastError = recent[recent.length - 1];

          expect(lastError).toBeDefined();
          expect(lastError.context.traceId).toBe(activeSpan.traceId);
          expect(lastError.context.spanId).toBe(activeSpan.id);
          expect(lastError.context.traceparent).toBe(
            activeSpan.getTraceparent(),
          );
        },
      );
    });
  });
});
