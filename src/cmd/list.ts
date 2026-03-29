import type { ArgumentsCamelCase } from "yargs";

import { listAgents } from "../lib/agents.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";

type ListArguments = {
   json?: boolean;
};

export const command = "list";
export const describe = "List available specialist agents";

export const builder = {
   json: {
      default: false,
      describe: "Print JSON output",
      type: "boolean"
   }
} as const;

export async function handler(
   args: ArgumentsCamelCase<ListArguments>
): Promise<void> {
   const agents = await listAgents(getProjectPaths());

   if (args.json) {
      writeJson({ agents });
      return;
   }

   if (agents.length === 0) {
      process.stdout.write("No agents found.\n");
      return;
   }

   for (const agent of agents) {
      process.stdout.write(
         `${agent.name}\t${agent.provider}\t${agent.description}\n`
      );
   }
}
