export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

export function badge(
  text: string,
  type: "ok" | "warn" | "fail" | "info" | "neutral" = "info",
): string {
  switch (type) {
    case "ok":
      return `${c.green}${c.bold}[OK]${c.reset}`;
    case "warn":
      return `${c.yellow}${c.bold}[WARN]${c.reset}`;
    case "fail":
      return `${c.red}${c.bold}[FAIL]${c.reset}`;
    case "info":
      return `${c.blue}${c.bold}[INFO]${c.reset}`;
    case "neutral":
      return `${c.dim}[${text}]${c.reset}`;
  }
}

export function formatTable(
  headers: string[],
  rows: string[][],
  options: { padding?: number } = {},
): string {
  const pad = options.padding ?? 2;
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const len = stripAnsi(r[i] || "").length;
      if (len > max) max = len;
    }
    return max;
  });

  const padStr = " ".repeat(pad);
  const headerLine = headers
    .map((h, i) => `${c.bold}${h.padEnd(colWidths[i])}${c.reset}`)
    .join(padStr);
  const dividerLine = colWidths.map((w) => "─".repeat(w)).join(padStr);

  const rowLines = rows.map((r) =>
    r
      .map((cell, i) => {
        const raw = cell || "";
        const visibleLen = stripAnsi(raw).length;
        const extraPad = " ".repeat(Math.max(0, colWidths[i] - visibleLen));
        return `${raw}${extraPad}`;
      })
      .join(padStr),
  );

  return [headerLine, `${c.dim}${dividerLine}${c.reset}`, ...rowLines].join(
    "\n",
  );
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[\d+;?\d*m/g, "");
}

export function printBanner(title: string, subtitle?: string): void {
  const width = 68;
  const line = "─".repeat(width);
  console.log(`\n${c.blue}${line}${c.reset}`);
  console.log(`${c.bold}${c.white}  ${title}${c.reset}`);
  if (subtitle) {
    console.log(`${c.dim}  ${subtitle}${c.reset}`);
  }
  console.log(`${c.blue}${line}${c.reset}\n`);
}

export function formatProgressBar(percent: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  let color = c.green;
  if (clamped >= 90) color = c.red;
  else if (clamped >= 75) color = c.yellow;

  return `${color}[${bar}]${c.reset} ${c.bold}${clamped.toFixed(1)}%${c.reset}`;
}
