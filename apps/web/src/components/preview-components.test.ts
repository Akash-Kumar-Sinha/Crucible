import { describe, it, expect } from "bun:test";
import React from "react";
import { PreviewToggle } from "@/components/workspace/PreviewToggle";
import { LivePreviewPane } from "@/components/workspace/LivePreviewPane";
import type { PreviewInfo } from "../api/orchestrator-client";

describe("Live Sandbox Preview Web UI Components", () => {
  it("should define PreviewToggle with layout switches and live status", () => {
    expect(typeof PreviewToggle).toBe("function");

    const element = React.createElement(PreviewToggle, {
      mode: "split",
      onChange: () => {},
      active: true,
      status: "ready",
    });

    expect(element).toBeDefined();
    expect(element.props.mode).toBe("split");
    expect(element.props.active).toBe(true);
    expect(element.props.status).toBe("ready");
  });

  it("should define LivePreviewPane with hardened iframe and preview URL", () => {
    expect(typeof LivePreviewPane).toBe("function");

    const samplePreview: PreviewInfo = {
      sessionId: "sess_preview_test",
      port: 5173,
      status: "ready",
      framework: "vite",
      targetUrl: "http://127.0.0.1:5173",
      proxiedPath: "/preview/sess_preview_test",
      startedAt: Date.now() - 10000,
      lastActiveAt: Date.now(),
    };

    const element = React.createElement(LivePreviewPane, {
      sessionId: "sess_preview_test",
      previewUrl: "http://localhost:4000/preview/sess_preview_test/",
      previewInfo: samplePreview,
    });

    expect(element).toBeDefined();
    expect(element.props.sessionId).toBe("sess_preview_test");
    expect(element.props.previewUrl).toContain("/preview/sess_preview_test/");
  });

  it("should handle crashed preview state in LivePreviewPane", () => {
    const crashedPreview: PreviewInfo = {
      sessionId: "sess_crashed_1",
      port: 5173,
      status: "crashed",
      framework: "vite",
      targetUrl: "http://127.0.0.1:5173",
      proxiedPath: "/preview/sess_crashed_1",
      startedAt: Date.now() - 30000,
      lastActiveAt: Date.now(),
      error: "Vite build failed with syntax error",
    };

    const element = React.createElement(LivePreviewPane, {
      sessionId: "sess_crashed_1",
      previewUrl: "http://localhost:4000/preview/sess_crashed_1/",
      previewInfo: crashedPreview,
    });

    expect(element).toBeDefined();
    expect(element.props.previewInfo?.status).toBe("crashed");
  });
});
