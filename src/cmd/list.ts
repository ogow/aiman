import type { ArgumentsCamelCase } from "yargs";

import { agentScopeChoices, listAgents } from "../lib/agents.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderSection, renderTable, truncateText } from "../lib/pretty.js";
import type { AgentScope } from "../lib/types.js";

const maxDescriptionLength = 60;

type ListArguments = {
   json?: boolean;
   scope?: AgentScope;
};

export const command = "list";
export const describe = "List available specialist agents";

export const builder = {
   json: {
      default: false,
      describe: "Print JSON output",
      type: "boolean"
   },
   scope: {
      choices: agentScopeChoices,
      describe: "Limit listing to one scope",
      type: "string"
   }
} as const;

export async function handler(
   args: ArgumentsCamelCase<ListArguments>
): Promise<void> {
   const agents = await listAgents(getProjectPaths(), args.scope);

   if (args.json) {
      writeJson({ agents });
      return;
   }

   if (agents.length === 0) {
      process.stdout.write(
         'No agents found.\n\nUse "aiman agent create <name> ..." to create one.\n'
      );
      return;
   }

   const table = renderTable(
      ["Name", "Scope", "Provider", "Description"],
      agents.map((agent) => [
         agent.name,
         agent.scope,
         agent.provider,
         truncateText(agent.description, maxDescriptionLength)
      ])
   );

   process.stdout.write(
      `${renderSection("Agents", table)}\n\nUse "aiman agent show <agent>" for rights, provider behavior, and prompt details.\n`
   );
}
