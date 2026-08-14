/**
 * Utility for parsing and sanitizing thought tags from model outputs
 */
export function extractThought(content: string): string | undefined {
  const match = content.match(/<thought>([\s\S]*?)<\/thought>/i);
  return match ? match[1].trim() : undefined;
}

export function cleanThoughtTags(content: string): string {
  return content.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
}
