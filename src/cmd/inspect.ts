import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { readRunDetails, readRunLog } from "../lib/runs.js";

type InspectArguments = {
   json?: boolean;
   runId?: string;
   stream?: "stderr" | "stdout";
};

export const command = "inspect <runId>";
export const describe = "Inspect one persisted run";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("runId", {
         describe: "Run id",
         type: "string"
      })
      .option("stream", {
         choices: ["stdout", "stderr"] as const,
         describe: "Show one log stream instead of the run record"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<InspectArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   if (args.stream) {
      const content = await readRunLog(args.runId, args.stream);

      if (args.json) {
         writeJson({
            content,
            runId: args.runId,
            stream: args.stream
         });
         return;
      }

      process.stdout.write(content);
      return;
   }

   const run = await readRunDetails(args.runId);

   if (args.json) {
      writeJson(run);
      return;
   }

   process.stdout.write(JSON.stringify(run, null, 2));
   process.stdout.write("\n");
}
