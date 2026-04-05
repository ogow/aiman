import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { agentScopeChoices } from "../lib/agents.js";
import { writeJson } from "../lib/output.js";
import { renderSection, renderTable } from "../lib/pretty.js";
import type { ProfileScope } from "../lib/types.js";

type AgentListArguments = {
   json?: boolean;
   scope?: ProfileScope;
};

export const command = "list";
export const describe = "List available agents";

export function builder(yargs: Argv): Argv {
   return yargs
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Resolve agents from one scope only",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<AgentListArguments>
): Promise<void> {
   const agents = await (await createAiman()).agents.list(args.scope);

   if (args.json) {
      writeJson({ agents });
      return;
   }

   if (agents.length === 0) {
      process.stdout.write("No agents found.\n");
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Agents",
         renderTable(
            ["Name", "Scope", "Provider", "Mode", "Description"],
            agents.map((agent) => [
               agent.name,
               agent.isBuiltIn === true ? "builtin" : agent.scope,
               agent.provider,
               agent.mode,
               agent.description
            ])
         )
      )}\n`
   );
}
