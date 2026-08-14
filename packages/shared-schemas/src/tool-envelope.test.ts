import { describe, expect, it } from "bun:test";
import {
  ENVELOPE_VERSION_V1,
  ToolCallEnvelopeV1Schema,
  ToolResultEnvelopeV1Schema,
  createToolCallV1,
  createToolErrorResultV1,
  createToolRejectedResultV1,
  createToolRequiresApprovalV1,
  createToolSuccessResultV1,
} from "./tool-envelope";

describe("Versioned Tool Envelopes (v1)", () => {
  it("should create and validate ToolCallEnvelopeV1", () => {
    const call = createToolCallV1({
      callId: "call_123",
      toolName: "calculator",
      input: { expression: "2 + 2" },
      metadata: { sessionId: "sess_abc" },
    });

    expect(call.version).toBe(ENVELOPE_VERSION_V1);
    expect(call.callId).toBe("call_123");
    expect(call.toolName).toBe("calculator");
    expect(call.input).toEqual({ expression: "2 + 2" });
    expect(call.metadata).toEqual({ sessionId: "sess_abc" });

    // Validate schema parsing
    const parsed = ToolCallEnvelopeV1Schema.parse(call);
    expect(parsed).toEqual(call);
  });

  it("should create and validate successful ToolResultEnvelopeV1", () => {
    const res = createToolSuccessResultV1({
      callId: "call_123",
      toolName: "calculator",
      output: { result: 4 },
      durationMs: 12,
    });

    expect(res.version).toBe(ENVELOPE_VERSION_V1);
    expect(res.status).toBe("success");
    expect(res.output).toEqual({ result: 4 });
    expect(res.durationMs).toBe(12);
    expect(res.error).toBeUndefined();

    const parsed = ToolResultEnvelopeV1Schema.parse(res);
    expect(parsed.status).toBe("success");
  });

  it("should create and validate error ToolResultEnvelopeV1", () => {
    const res = createToolErrorResultV1({
      callId: "call_123",
      toolName: "calculator",
      message: "Divide by zero",
      code: "MATH_ERROR",
      durationMs: 5,
    });

    expect(res.status).toBe("error");
    expect(res.error?.message).toBe("Divide by zero");
    expect(res.error?.code).toBe("MATH_ERROR");
  });

  it("should create approval required and rejected envelopes", () => {
    const reqApproval = createToolRequiresApprovalV1({
      callId: "call_danger",
      toolName: "delete_db",
    });
    expect(reqApproval.status).toBe("requires_approval");

    const rejected = createToolRejectedResultV1({
      callId: "call_danger",
      toolName: "delete_db",
      reason: "User denied permission",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.error?.message).toBe("User denied permission");
  });
});
