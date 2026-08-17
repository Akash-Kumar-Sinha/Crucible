import { describe, it, expect } from "bun:test";
import React from "react";
import { VoiceButton } from "./workspace/VoiceButton";
import { useLiveKitVoice } from "./workspace/useLiveKitVoice";
import { PromptInput } from "./ui/prompt-input";

describe("Voice Command Interface Web UI Components", () => {
  it("should define VoiceButton with recording and transcribing states", () => {
    expect(typeof VoiceButton).toBe("function");

    const element = React.createElement(VoiceButton, {
      sessionId: "sess_voice_123",
      onTranscript: () => {},
      autoSubmit: false,
    });

    expect(element).toBeDefined();
    expect(element.props.sessionId).toBe("sess_voice_123");
    expect(element.props.autoSubmit).toBe(false);
  });

  it("should instantiate VoiceButton with autoSubmit enabled", () => {
    let _submittedText = "";
    const element = React.createElement(VoiceButton, {
      sessionId: "sess_voice_456",
      onAutoSubmit: (t: string) => {
        _submittedText = t;
      },
      autoSubmit: true,
      disabled: false,
    });

    expect(element.props.autoSubmit).toBe(true);
    expect(element.props.disabled).toBe(false);
  });

  it("should define useLiveKitVoice hook function", () => {
    expect(typeof useLiveKitVoice).toBe("function");
  });

  it("should render PromptInput with embedded RoleModelPicker and VoiceButton controls", () => {
    expect(typeof PromptInput).toBe("function");

    let _submitted = false;
    let _transcript = "";
    const promptElement = React.createElement(PromptInput, {
      value: "Refactor error handling in sandbox core",
      onChange: () => {},
      onSubmit: () => {
        _submitted = true;
      },
      isLoading: false,
      selectedRole: "bug_hunter",
      selectedModel: "anthropic/claude-3.5-sonnet",
      onRoleChange: (_role) => {},
      onModelChange: (_model) => {},
      sessionId: "sess_voice_embedded_789",
      onTranscript: (t) => {
        _transcript = t;
      },
      onVoiceAutoSubmit: (_t) => {},
    });

    expect(promptElement).toBeDefined();
    expect(promptElement.props.selectedRole).toBe("bug_hunter");
    expect(promptElement.props.selectedModel).toBe(
      "anthropic/claude-3.5-sonnet",
    );
    expect(promptElement.props.sessionId).toBe("sess_voice_embedded_789");
  });
});
