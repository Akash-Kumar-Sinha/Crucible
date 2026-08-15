import { describe, expect, it } from "bun:test";
import {
  extractThought,
  cleanThoughtTags,
  StreamingThoughtExtractor,
} from "./thought-parser";

describe("Thought Parser & Streaming Thought Extractor", () => {
  it("should extract thought from static content using <thought> and <think> tags", () => {
    const text1 = "<thought>Thinking step 1</thought>Final Answer";
    expect(extractThought(text1)).toBe("Thinking step 1");
    expect(cleanThoughtTags(text1)).toBe("Final Answer");

    const text2 = "<think>Deep thought process</think>42";
    expect(extractThought(text2)).toBe("Deep thought process");
    expect(cleanThoughtTags(text2)).toBe("42");
  });

  it("should stream thought and tokens correctly when tags are within single chunks", () => {
    let thoughts = "";
    let tokens = "";

    const extractor = new StreamingThoughtExtractor({
      onThought: (th) => (thoughts += th),
      onToken: (tok) => (tokens += tok),
    });

    extractor.feed("<thought>Analyzing the problem</thought>The answer is 42.");
    extractor.flush();

    expect(thoughts).toBe("Analyzing the problem");
    expect(tokens).toBe("The answer is 42.");
  });

  it("should handle thought tags split across multiple chunk boundaries", () => {
    let thoughts = "";
    let tokens = "";

    const extractor = new StreamingThoughtExtractor({
      onThought: (th) => (thoughts += th),
      onToken: (tok) => (tokens += tok),
    });

    extractor.feed("<th");
    extractor.feed("ought>");
    extractor.feed("I need to calculate 2 + 2.");
    extractor.feed("</th");
    extractor.feed("ought>");
    extractor.feed("Result: 4");
    extractor.flush();

    expect(thoughts).toBe("I need to calculate 2 + 2.");
    expect(tokens).toBe("Result: 4");
  });

  it("should handle think tags and content with angle brackets", () => {
    let thoughts = "";
    let tokens = "";

    const extractor = new StreamingThoughtExtractor({
      onThought: (th) => (thoughts += th),
      onToken: (tok) => (tokens += tok),
    });

    extractor.feed("Prefix 3 < 5 then ");
    extractor.feed("<think>Reasoning: 2 < 3 is true</think>");
    extractor.feed(" Final output.");
    extractor.flush();

    expect(thoughts).toBe("Reasoning: 2 < 3 is true");
    expect(tokens).toBe("Prefix 3 < 5 then  Final output.");
  });
});
