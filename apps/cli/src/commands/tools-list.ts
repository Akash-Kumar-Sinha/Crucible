import { CrucibleClient, type ToolInfo } from "@crucible/sdk";
import { c, formatTable, printBanner } from "../formatters";

export interface ToolsListCommandOptions {
  endpoint?: string;
  category?: string;
  json?: boolean;
}

export async function runToolsListCommand(
  options: ToolsListCommandOptions = {},
): Promise<number> {
  const endpoint =
    options.endpoint ||
    process.env.CRUCIBLE_ENDPOINT ||
    (process.env.PORT
      ? `http://localhost:${process.env.PORT}`
      : "http://localhost:4000");

  const client = new CrucibleClient({ endpoint });

  if (!options.json) {
    printBanner(
      "Crucible Tool Registry",
      `Fetching registered tool definitions from ${endpoint}`,
    );
  }

  let tools: ToolInfo[];
  try {
    tools = await client.tools.list();
  } catch (err: any) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { status: "error", error: err.message || String(err) },
          null,
          2,
        ),
      );
      return 1;
    }
    console.error(
      `${c.red}Failed to fetch tools from orchestrator:${c.reset} ${err.message || err}`,
    );
    return 1;
  }

  if (options.category) {
    tools = tools.filter(
      (t) => t.category.toLowerCase() === options.category!.toLowerCase(),
    );
  }

  if (options.json) {
    console.log(JSON.stringify(tools, null, 2));
    return 0;
  }

  if (tools.length === 0) {
    console.log(`${c.yellow}No tools found matching query.${c.reset}\n`);
    return 0;
  }

  const tableHeaders = [
    "Tool Name",
    "Category",
    "Version",
    "Approval?",
    "Parameters Summary",
  ];
  const tableRows: string[][] = tools.map((tool) => {
    const params = tool.parameters?.properties
      ? Object.keys(tool.parameters.properties as Record<string, unknown>).join(
          ", ",
        )
      : "none";

    const approvalBadge = tool.requiresApproval
      ? `${c.yellow}Required${c.reset}`
      : `${c.dim}Auto${c.reset}`;

    return [
      `${c.bold}${c.cyan}${tool.name}${c.reset}`,
      tool.category || "general",
      tool.version || "1.0.0",
      approvalBadge,
      params || "none",
    ];
  });

  console.log(formatTable(tableHeaders, tableRows));
  console.log(`\n${c.dim}Total Tools: ${tools.length}${c.reset}\n`);

  return 0;
}
