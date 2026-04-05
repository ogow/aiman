import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderStatusView } from "../lib/run-render.js";

type StatusArguments = {
   json?: boolean;
   runId?: string;
};

export const command = "show <runId>";
export const describe = "Show the human-friendly status for one run";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("runId", {
         describe: "Run id",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<StatusArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   const [run, recentOutput] = await Promise.all([
      (await createAiman()).runs.get(args.runId),
      (await createAiman()).runs.readOutput(args.runId, "all", 20)
   ]);

   if (args.json) {
      writeJson({
         recentOutput,
         run
      });
      return;
   }

   process.stdout.write(renderStatusView({ recentOutput, run }));
}
