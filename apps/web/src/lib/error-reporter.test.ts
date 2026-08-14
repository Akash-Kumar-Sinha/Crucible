import { describe, it, expect } from "bun:test";
import { captureClientError } from "./error-reporter";

describe("Web UI Client Error Reporter", () => {
  it("should capture Error instance and generate structured error record", () => {
    const errorId = captureClientError(
      new Error("Component rendering crashed"),
      {
        component: "ChatWindow",
        sessionId: "sess_web_123",
        route: "/session/sess_web_123",
      },
    );

    expect(errorId).toBeString();
    expect(errorId.startsWith("web_err_")).toBeTrue();
  });

  it("should capture string error message and object context", () => {
    const errorId = captureClientError("Unexpected network rejection", {
      component: "SessionSidebar",
      action: "fetch_sessions",
    });

    expect(errorId).toBeString();
    expect(errorId.startsWith("web_err_")).toBeTrue();
  });
});
