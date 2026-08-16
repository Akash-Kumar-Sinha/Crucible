import { describe, it, expect } from "bun:test";
import {
  extractCodeBlocks,
  synthesizeLivePreview,
} from "./preview-synthesizer";

describe("Preview Synthesizer", () => {
  it("should extract code blocks with language and filename", () => {
    const markdown = `
Here is the HTML file:
\`\`\`html index.html
<div class="p-4 bg-zinc-900 text-white">Hello World</div>
\`\`\`

And the React component:
\`\`\`tsx App.tsx
export default function App() {
  return <h1>Hackathon Platform</h1>;
}
\`\`\`
`;

    const blocks = extractCodeBlocks(markdown);
    expect(blocks.length).toBe(2);
    expect(blocks[0].lang).toBe("html");
    expect(blocks[0].filename).toBe("index.html");
    expect(blocks[0].code).toContain("Hello World");

    expect(blocks[1].lang).toBe("tsx");
    expect(blocks[1].filename).toBe("App.tsx");
    expect(blocks[1].code).toContain("Hackathon Platform");
  });

  it("should synthesize live preview from full HTML", () => {
    const fullHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hackathon</h1></body></html>`;
    const synthesized = synthesizeLivePreview(fullHtml, "sess_123");

    expect(synthesized).not.toBeNull();
    expect(synthesized).toContain("Hackathon");
    expect(synthesized).toContain("tailwindcss.com");
  });

  it("should synthesize live preview from HTML code block in markdown", () => {
    const markdown = `
Here is your frontend:
\`\`\`html
<div class="flex items-center justify-center min-h-screen bg-slate-900 text-white">
  <h1 class="text-3xl font-bold">Global AI Hackathon 2026</h1>
</div>
\`\`\`
`;
    const synthesized = synthesizeLivePreview(markdown, "sess_123");

    expect(synthesized).not.toBeNull();
    expect(synthesized).toContain("Global AI Hackathon 2026");
    expect(synthesized).toContain("tailwindcss.com");
  });

  it("should synthesize live preview from React / TSX code block", () => {
    const markdown = `
Below is a complete starter kit:
\`\`\`tsx
export default function HackathonApp() {
  const [count, setCount] = React.useState(0);
  return (
    <div className="p-6 bg-zinc-950 text-white min-h-screen">
      <h1 className="text-2xl font-bold">Hackathon Arena</h1>
      <button onClick={() => setCount(c => c + 1)}>Register ({count})</button>
    </div>
  );
}
\`\`\`
`;
    const synthesized = synthesizeLivePreview(markdown, "sess_123");

    expect(synthesized).not.toBeNull();
    expect(synthesized).toContain("HackathonApp");
    expect(synthesized).toContain("react.production.min.js");
    expect(synthesized).toContain("@babel/standalone");
    expect(synthesized).toContain("ReactDOM.createRoot");
  });
});
