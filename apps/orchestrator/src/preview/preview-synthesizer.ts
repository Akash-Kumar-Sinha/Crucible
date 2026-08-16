/**
 * Preview Synthesizer: Converts assistant outputs, markdown code blocks,
 * and written files into a complete, standalone, interactive live preview HTML.
 */

export function extractCodeBlocks(
  text: string,
): Array<{ lang: string; code: string; filename?: string }> {
  const blocks: Array<{ lang: string; code: string; filename?: string }> = [];
  const codeBlockRegex =
    /```([a-zA-Z0-9_-]+)?(?:[^\S\r\n]+([^\r\n]+))?\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || "").toLowerCase().trim();
    const filename = (match[2] || "").trim() || undefined;
    const code = match[3].trim();
    if (code) {
      blocks.push({ lang, filename, code });
    }
  }

  return blocks;
}

export function synthesizeLivePreview(
  content: string,
  sessionId?: string,
): string | null {
  if (!content || typeof content !== "string") return null;

  // 1. Direct full HTML document detection
  if (
    content.includes("<!DOCTYPE html>") ||
    (content.includes("<html") && content.includes("</html>"))
  ) {
    return injectPreviewEnhancements(content);
  }

  const blocks = extractCodeBlocks(content);

  // 2. Look for HTML block
  const htmlBlock = blocks.find(
    (b) =>
      b.lang === "html" ||
      b.filename?.endsWith(".html") ||
      b.code.includes("<!DOCTYPE html>") ||
      b.code.includes("<html"),
  );

  if (htmlBlock) {
    if (
      htmlBlock.code.includes("<!DOCTYPE html>") ||
      htmlBlock.code.includes("<html")
    ) {
      return injectPreviewEnhancements(htmlBlock.code);
    }
    return wrapHtmlBody(htmlBlock.code, sessionId);
  }

  // 3. Look for React / JSX / TSX block
  const reactBlock = blocks.find(
    (b) =>
      b.lang === "jsx" ||
      b.lang === "tsx" ||
      b.lang === "react" ||
      b.filename?.endsWith(".tsx") ||
      b.filename?.endsWith(".jsx") ||
      b.code.includes("import React") ||
      b.code.includes("export default function") ||
      b.code.includes("const App =") ||
      b.code.includes("function App("),
  );

  if (reactBlock) {
    return wrapReactComponent(reactBlock.code, sessionId);
  }

  // 4. Look for raw HTML elements if present
  if (content.includes("<div") && content.includes("</div>")) {
    return wrapHtmlBody(content, sessionId);
  }

  // 5. Look for JavaScript or TypeScript block with UI creation
  const jsBlock = blocks.find(
    (b) =>
      (b.lang === "js" || b.lang === "javascript" || b.lang === "ts") &&
      (b.code.includes("document.createElement") ||
        b.code.includes("innerHTML") ||
        b.code.includes("addEventListener")),
  );

  if (jsBlock) {
    return wrapVanillaJs(jsBlock.code, sessionId);
  }

  return null;
}

function injectPreviewEnhancements(html: string): string {
  if (!html.includes("tailwindcss.com") && !html.includes("<style")) {
    html = html.replace(
      "<head>",
      '<head>\n  <script src="https://cdn.tailwindcss.com"></script>\n  <script src="https://unpkg.com/lucide@latest"></script>',
    );
  }

  if (html.includes("</body>")) {
    html = html.replace(
      "</body>",
      "  <script>if (window.lucide) { lucide.createIcons(); }</script>\n</body>",
    );
  }

  return html;
}

function wrapHtmlBody(bodyContent: string, sessionId?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview - ${sessionId || "Crucible Sandbox"}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased selection:bg-sky-500 selection:text-white">
  ${bodyContent}
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      if (window.lucide) {
        lucide.createIcons();
      }
    });
  </script>
</body>
</html>`;
}

function wrapReactComponent(componentCode: string, sessionId?: string): string {
  let cleaned = componentCode;

  // 1. Remove import statements
  cleaned = cleaned.replace(
    /^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,
    "",
  );
  cleaned = cleaned.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, "");

  // 2. Identify default export or main component name
  let rootComponentName = "App";
  const defaultFuncMatch = cleaned.match(
    /export\s+default\s+function\s+([A-Za-z0-9_]+)/,
  );
  const defaultIdentMatch = cleaned.match(
    /export\s+default\s+([A-Za-z0-9_]+)\s*;?/,
  );

  if (defaultFuncMatch) {
    rootComponentName = defaultFuncMatch[1];
  } else if (defaultIdentMatch && defaultIdentMatch[1] !== "function") {
    rootComponentName = defaultIdentMatch[1];
  } else {
    const namedMatch = cleaned.match(
      /(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/,
    );
    if (namedMatch) {
      rootComponentName = namedMatch[1];
    }
  }

  // 3. Normalize exports
  cleaned = cleaned.replace(/export\s+default\s+function\s+/g, "function ");
  cleaned = cleaned.replace(/export\s+default\s+[A-Za-z0-9_]+\s*;?/g, "");
  cleaned = cleaned.replace(/export\s+(?:const|function|let|var)\s+/g, (m) =>
    m.replace("export ", ""),
  );
  cleaned = cleaned.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview - ${sessionId || "Crucible Sandbox"}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased selection:bg-sky-500 selection:text-white">
  <div id="root"></div>

  <!-- Lucide Icon Proxy for React -->
  <script>
    const { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } = React;
    
    // Lucide Icon Component Helper
    window.Icon = ({ name, size = 16, className = "" }) => {
      const ref = React.useRef(null);
      React.useEffect(() => {
        if (ref.current && window.lucide) {
          window.lucide.createIcons({
            root: ref.current,
            nameAttrs: { 'data-lucide': name }
          });
        }
      }, [name, size, className]);
      return React.createElement('i', {
        ref,
        'data-lucide': name,
        className,
        style: { width: size, height: size, display: 'inline-flex' }
      });
    };
  </script>

  <!-- User Component Compilation & Mount -->
  <script type="text/babel">
    try {
      ${cleaned}

      const TargetComponent = typeof ${rootComponentName} !== 'undefined' ? ${rootComponentName} : () => (
        <div className="p-8 text-center text-zinc-400 font-mono text-xs">
          Component <span className="text-white font-bold">${rootComponentName}</span> loaded.
        </div>
      );

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<TargetComponent />);
    } catch (err) {
      document.getElementById('root').innerHTML = \`
        <div style="padding: 24px; font-family: monospace; color: #f87171; background: #450a0a; border: 1px solid #dc2626; border-radius: 8px; margin: 16px;">
          <div style="font-weight: bold; margin-bottom: 8px;">Preview Render Error</div>
          <div style="font-size: 12px; white-space: pre-wrap;">\${err.message}</div>
        </div>
      \`;
      console.error(err);
    }
  </script>
</body>
</html>`;
}

function wrapVanillaJs(jsCode: string, sessionId?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview - ${sessionId || "Crucible Sandbox"}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen p-6">
  <div id="app"></div>
  <script>
    try {
      ${jsCode}
      if (window.lucide) { lucide.createIcons(); }
    } catch (err) {
      document.body.innerHTML = '<div style="color: #f87171; font-family: monospace;">' + err.message + '</div>';
    }
  </script>
</body>
</html>`;
}
