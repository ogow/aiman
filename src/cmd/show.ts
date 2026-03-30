import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices, loadAgentDefinition } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import type { AgentScope } from "../lib/types.js";

type ShowArguments = {
   agent?: string;
   json?: boolean;
   scope?: AgentScope;
};

export const command = "show <agent>";
export const describe = "Show one specialist agent";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("agent", {
         describe: "Agent name",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Resolve the agent from one scope only",
         type: "string"
      });
}

export async function handler(
   args: ArgumentsCamelCase<ShowArguments>
): Promise<void> {
   if (typeof args.agent !== "string" || args.agent.length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agent = await loadAgentDefinition(
      getProjectPaths(),
      args.agent,
      args.scope
   );

   if (args.json) {
      writeJson({ agent });
      return;
   }

   process.stdout.write(`name: ${agent.name}\n`);
   process.stdout.write(`scope: ${agent.scope}\n`);
   process.stdout.write(`path: ${agent.path}\n`);
   process.stdout.write(`provider: ${agent.provider}\n`);
   process.stdout.write(`description: ${agent.description}\n`);

   if (agent.model) {
      process.stdout.write(`model: ${agent.model}\n`);
   }

   if (agent.reasoningEffort) {
      process.stdout.write(`reasoningEffort: ${agent.reasoningEffort}\n`);
   }

   process.stdout.write("\n");
   process.stdout.write(`${agent.body}\n`);
}
