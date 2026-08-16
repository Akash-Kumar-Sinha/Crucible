"use client";

import * as React from "react";
import { CodeBlock } from "@/components/ui/code-block";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Regex to split by bold, italic, inline code, links
  const tokens = text.split(
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g,
  );

  return tokens.map((token, i) => {
    if (!token) return null;

    // Inline Code
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      return (
        <code
          key={i}
          className="rounded-md border border-white/10 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-xs text-blue-400"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    // Bold
    if (token.startsWith("**") && token.endsWith("**") && token.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }

    // Italic
    if (token.startsWith("*") && token.endsWith("*") && token.length >= 2) {
      return (
        <em key={i} className="italic text-zinc-300">
          {token.slice(1, -1)}
        </em>
      );
    }

    // Link: [label](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      return (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
        >
          {label}
        </a>
      );
    }

    return <React.Fragment key={i}>{token}</React.Fragment>;
  });
}

function parseMarkdownBlocks(markdown: string): React.ReactNode[] {
  const lines = markdown.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block
    if (line.trim().startsWith("```")) {
      const langMatch = line.trim().match(/^```(\w*)/);
      const language = langMatch && langMatch[1] ? langMatch[1] : "text";
      const codeLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      const code = codeLines.join("\n");
      nodes.push(
        <div key={`code-${i}`} className="my-3 overflow-hidden rounded-lg">
          <CodeBlock
            language={language}
            filename={language.toUpperCase()}
            code={code}
          />
        </div>,
      );
      continue;
    }

    // Markdown Table
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      lines[i + 1].includes("---")
    ) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0]
          .split("|")
          .map((c) => c.trim())
          .filter((_c, idx, arr) => idx > 0 && idx < arr.length - 1);
        const rows = tableLines.slice(2).map((r) =>
          r
            .split("|")
            .map((c) => c.trim())
            .filter((_c, idx, arr) => idx > 0 && idx < arr.length - 1),
        );

        nodes.push(
          <div
            key={`table-${i}`}
            className="my-4 overflow-x-auto rounded-lg border border-white/10"
          >
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-zinc-900 border-b border-white/10 text-zinc-200">
                <tr>
                  {headerCells.map((cell, cIdx) => (
                    <th key={cIdx} className="px-3.5 py-2.5 font-semibold">
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-zinc-950/60 text-zinc-300">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-white/5 transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3.5 py-2">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    // Headers
    if (line.startsWith("# ")) {
      nodes.push(
        <h1
          key={`h1-${i}`}
          className="text-xl font-bold text-white border-b border-white/10 pb-2 mb-3 mt-5 first:mt-0 tracking-tight"
        >
          {renderInlineMarkdown(line.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h2
          key={`h2-${i}`}
          className="text-lg font-semibold text-white border-b border-white/8 pb-1.5 mb-2.5 mt-4 tracking-tight"
        >
          {renderInlineMarkdown(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      nodes.push(
        <h3
          key={`h3-${i}`}
          className="text-base font-semibold text-zinc-100 mb-2 mt-3.5"
        >
          {renderInlineMarkdown(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }

    if (line.startsWith("#### ")) {
      nodes.push(
        <h4
          key={`h4-${i}`}
          className="text-sm font-medium text-zinc-200 mb-1.5 mt-3"
        >
          {renderInlineMarkdown(line.slice(5))}
        </h4>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote
          key={`quote-${i}`}
          className="my-2.5 border-l-2 border-white/20 bg-white/5 px-3.5 py-2 text-xs italic text-zinc-300 rounded-r-md"
        >
          {renderInlineMarkdown(line.slice(2))}
        </blockquote>,
      );
      i++;
      continue;
    }

    // Horizontal Rule
    if (
      line.trim() === "---" ||
      line.trim() === "***" ||
      line.trim() === "___"
    ) {
      nodes.push(
        <hr key={`hr-${i}`} className="my-4 border-t border-white/10" />,
      );
      i++;
      continue;
    }

    // Unordered List (- item or * item)
    if (line.match(/^(\s*)[-*]\s+(.+)/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)[-*]\s+(.+)/)) {
        const itemMatch = lines[i].match(/^(\s*)[-*]\s+(.+)/);
        if (itemMatch) listItems.push(itemMatch[2]);
        i++;
      }

      nodes.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1.5 list-none pl-1">
          {listItems.map((item, lIdx) => (
            <li
              key={lIdx}
              className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"
            >
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />
              <span>{renderInlineMarkdown(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered List (1. item)
    if (line.match(/^(\s*)\d+\.\s+(.+)/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)\d+\.\s+(.+)/)) {
        const itemMatch = lines[i].match(/^(\s*)\d+\.\s+(.+)/);
        if (itemMatch) listItems.push(itemMatch[2]);
        i++;
      }

      nodes.push(
        <ol key={`ol-${i}`} className="my-2 space-y-1.5 list-none pl-1">
          {listItems.map((item, lIdx) => (
            <li
              key={lIdx}
              className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"
            >
              <span className="font-mono text-[11px] font-semibold text-zinc-400 shrink-0 min-w-4">
                {lIdx + 1}.
              </span>
              <span>{renderInlineMarkdown(item)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular Paragraph
    nodes.push(
      <p
        key={`p-${i}`}
        className="my-1.5 text-xs sm:text-sm leading-relaxed text-zinc-200"
      >
        {renderInlineMarkdown(line)}
      </p>,
    );
    i++;
  }

  return nodes;
}

export function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  const renderedNodes = React.useMemo(() => {
    return parseMarkdownBlocks(content);
  }, [content]);

  return (
    <div
      className={`markdown-body space-y-2 text-zinc-200 leading-relaxed ${className}`}
    >
      {renderedNodes}
    </div>
  );
}
