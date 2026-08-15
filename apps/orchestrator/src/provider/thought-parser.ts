export function extractThought(content: string): string | undefined {
  const thoughtMatch = content.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) return thoughtMatch[1].trim();
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  return thinkMatch ? thinkMatch[1].trim() : undefined;
}

export function cleanThoughtTags(content: string): string {
  return content
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

export class StreamingThoughtExtractor {
  private insideThought = false;
  private buffer = "";
  private readonly onToken?: (token: string) => void;
  private readonly onThought?: (thought: string) => void;

  constructor(
    options: {
      onToken?: (token: string) => void;
      onThought?: (thought: string) => void;
    } = {},
  ) {
    this.onToken = options.onToken;
    this.onThought = options.onThought;
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }

  private processBuffer(): void {
    const openTags = ["<thought>", "<think>"];
    const closeTags = ["</thought>", "</think>"];

    while (this.buffer.length > 0) {
      if (!this.insideThought) {
        const tagIndex = this.buffer.indexOf("<");
        if (tagIndex === -1) {
          const text = this.buffer;
          this.buffer = "";
          if (text) this.onToken?.(text);
          return;
        }

        if (tagIndex > 0) {
          const prefix = this.buffer.slice(0, tagIndex);
          this.buffer = this.buffer.slice(tagIndex);
          this.onToken?.(prefix);
        }

        const lowerBuf = this.buffer.toLowerCase();
        let matchedOpenTag: string | null = null;
        let isPotentialPrefix = false;

        for (const tag of openTags) {
          if (lowerBuf.startsWith(tag)) {
            matchedOpenTag = tag;
            break;
          }
          if (tag.startsWith(lowerBuf)) {
            isPotentialPrefix = true;
          }
        }

        if (matchedOpenTag) {
          this.insideThought = true;
          this.buffer = this.buffer.slice(matchedOpenTag.length);
          continue;
        }

        if (isPotentialPrefix && this.buffer.length < 10) {
          return;
        }

        const nonTagChar = this.buffer.slice(0, 1);
        this.buffer = this.buffer.slice(1);
        this.onToken?.(nonTagChar);
      } else {
        const tagIndex = this.buffer.indexOf("<");
        if (tagIndex === -1) {
          const text = this.buffer;
          this.buffer = "";
          if (text) this.onThought?.(text);
          return;
        }

        if (tagIndex > 0) {
          const prefix = this.buffer.slice(0, tagIndex);
          this.buffer = this.buffer.slice(tagIndex);
          this.onThought?.(prefix);
        }

        const lowerBuf = this.buffer.toLowerCase();
        let matchedCloseTag: string | null = null;
        let isPotentialPrefix = false;

        for (const tag of closeTags) {
          if (lowerBuf.startsWith(tag)) {
            matchedCloseTag = tag;
            break;
          }
          if (tag.startsWith(lowerBuf)) {
            isPotentialPrefix = true;
          }
        }

        if (matchedCloseTag) {
          this.insideThought = false;
          this.buffer = this.buffer.slice(matchedCloseTag.length);
          continue;
        }

        if (isPotentialPrefix && this.buffer.length < 11) {
          return;
        }

        const nonTagChar = this.buffer.slice(0, 1);
        this.buffer = this.buffer.slice(1);
        this.onThought?.(nonTagChar);
      }
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      if (this.insideThought) {
        this.onThought?.(this.buffer);
      } else {
        this.onToken?.(this.buffer);
      }
      this.buffer = "";
    }
  }
}
