import { describe, expect, it } from "bun:test";
import { generateSessionTitle } from "./title-generator";

describe("generateSessionTitle", () => {
  it("should extract clean title from short sentence", () => {
    expect(generateSessionTitle("what's the time")).toBe("What's the time");
  });

  it("should extract first non-empty line as title from multiline text", () => {
    const prompt = `Comedy: The Architecture of Laughter
Introduction
The word comedy carries within it a paradox...`;
    expect(generateSessionTitle(prompt)).toBe(
      "Comedy: The Architecture of Laughter",
    );
  });

  it("should strip markdown headers from title", () => {
    expect(
      generateSessionTitle("## Deploy to Kubernetes\nWe need to deploy..."),
    ).toBe("Deploy to Kubernetes");
  });

  it("should strip bullet points and list markers", () => {
    expect(generateSessionTitle("- check package.json dependencies")).toBe(
      "Check package.json dependencies",
    );
  });

  it("should truncate very long prompts cleanly at word boundary", () => {
    const longPrompt =
      "Can you please analyze all the system logs in var log and explain why the memory usage keeps spiking every 5 minutes?";
    const title = generateSessionTitle(longPrompt);
    expect(title.length).toBeLessThanOrEqual(45);
    expect(title.endsWith("...")).toBe(true);
  });

  it("should fallback to 'New Conversation' for empty prompts", () => {
    expect(generateSessionTitle("")).toBe("New Conversation");
    expect(generateSessionTitle("   \n\n  ")).toBe("New Conversation");
  });
});
