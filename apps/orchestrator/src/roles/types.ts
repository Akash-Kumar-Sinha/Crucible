export type AgentRoleId =
  "coder" | "test_writer" | "bug_hunter" | "bug_fixer" | "general";

export interface AgentRole {
  id: AgentRoleId;
  name: string;
  description: string;
  systemPrompt: string;
  defaultModel: string;
  allowedTools: string[];
  readOnly: boolean;
  tagColor?: string;
  capabilities: string[];
}
