/**
 * Clean session title generator that extracts concise, human-readable session names from user prompts.
 */
export function generateSessionTitle(prompt: string): string {
  if (!prompt || typeof prompt !== "string") {
    return "New Conversation";
  }

  // 1. Strip XML tags, thought tags, code fences
  const clean = prompt
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

  if (!clean) {
    return "New Conversation";
  }

  // 2. Extract the first non-empty line
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return "New Conversation";
  }

  let firstLine = lines[0];

  // 3. Remove leading markdown heading markers, list markers, quotes, and punctuation
  firstLine = firstLine
    .replace(/^([#>\-*\d.]+\s*)+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!firstLine) {
    firstLine = lines[1] || "New Conversation";
  }

  // 4. Truncate cleanly at a reasonable character length (40 chars) at word boundaries
  const maxLen = 42;
  let title = firstLine;
  if (title.length > maxLen) {
    const substr = title.substring(0, maxLen);
    const lastSpace = substr.lastIndexOf(" ");
    title =
      (lastSpace > 18 ? substr.substring(0, lastSpace) : substr).trim() + "...";
  }

  // 5. Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title || "New Conversation";
}
