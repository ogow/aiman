import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderInspectView } from "../lib/run-render.js";
import { readRunDetails, readRunLog } from "../lib/runs.js";

type InspectArguments = {
   json?: boolean;
   runId?: string;
   stream?: "prompt" | "run" | "stderr" | "stdout";
};

export const command = "inspect <runId>";
export const describe = "Inspect one persisted run record";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("runId", {
         describe: "Run id",
         type: "string"
      })
      .option("stream", {
         choices: ["run", "prompt", "stdout", "stderr"] as const,
         describe: "Show one persisted file instead of the parsed run details"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .example(
         "$0 run inspect reviewer-1234abcd",
         "Show detailed parsed run information"
      )
      .example(
         "$0 run inspect reviewer-1234abcd --stream prompt",
         "Read the exact prompt sent to the provider"
      );
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

   process.stdout.write(renderInspectView(run));
}
