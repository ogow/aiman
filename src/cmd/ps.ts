import type { ArgumentsCamelCase, Argv } from "yargs";

import { writeJson } from "../lib/output.js";
import { renderSection } from "../lib/pretty.js";
import { renderRunTable } from "../lib/run-render.js";
import { listRuns } from "../lib/runs.js";

type PsArguments = {
   all?: boolean;
   json?: boolean;
   limit?: number;
};

export const command = "list";
export const describe = "List sessions";

export function builder(yargs: Argv): Argv {
   return yargs
      .option("all", {
         default: false,
         describe: "Include recent finished runs",
         type: "boolean"
      })
      .option("limit", {
         default: 20,
         describe: "Maximum number of runs to show",
         type: "number"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<PsArguments>
): Promise<void> {
   const runs = await listRuns({
      filter: args.all === true ? "all" : "active",
      limit: args.limit ?? 20
   });

   if (args.json) {
      writeJson({
         runs
      });
      return;
   }

   if (runs.length === 0) {
      process.stdout.write(
         args.all === true
            ? "No agent runs found.\n"
            : "No running agents found.\n"
      );
      return;
   }

   process.stdout.write(
      `${renderSection("Runs", renderRunTable(runs))}\n\nUse "aiman sesh show <run-id>" for details.\n`
   );
}
