import type { ArgumentsCamelCase, Argv } from "yargs";

import { loadAgentDefinition } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";

type ShowArguments = {
   agent?: string;
   json?: boolean;
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
      });
}

export async function handler(
   args: ArgumentsCamelCase<ShowArguments>
): Promise<void> {
   if (typeof args.agent !== "string" || args.agent.length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agent = await loadAgentDefinition(getProjectPaths(), args.agent);

   if (args.json) {
      writeJson({ agent });
      return;
   }

   process.stdout.write(`name: ${agent.name}\n`);
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
