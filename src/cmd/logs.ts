import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import {
   followRunOutput,
   readRunOutput,
   type RunOutputStream
} from "../lib/run-output.js";

type LogsArguments = {
   follow?: boolean;
   json?: boolean;
   runId?: string;
   stream?: RunOutputStream;
   tail?: number;
};

export const command = "logs <runId>";
export const describe = "Show persisted run output";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("runId", {
         describe: "Run id",
         type: "string"
      })
      .option("stream", {
         choices: ["all", "stdout", "stderr"] as const,
         default: "all",
         describe: "Which output stream to show"
      })
      .option("follow", {
         alias: "f",
         default: false,
         describe: "Follow new output until the run finishes",
         type: "boolean"
      })
      .option("tail", {
         default: 40,
         describe: "How many lines to show from the end",
         type: "number"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .example("$0 run logs run-id", "Read the recent output for a run")
      .example(
         "$0 run logs run-id -f",
         "Follow live output until the run finishes"
      );
}

export async function handler(
   args: ArgumentsCamelCase<LogsArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   const stream = args.stream ?? "all";
   const tail = args.tail ?? 40;

   if (args.json && args.follow) {
      throw new UserError("`--follow` is not supported with `--json`.");
   }

   if (args.follow === true) {
      const finalRun = await followRunOutput({
         onChunk: (chunk) => {
            process.stdout.write(chunk);
         },
         runId: args.runId,
         stream,
         tailLines: tail
      });

      process.exitCode = finalRun.status === "success" ? 0 : 1;
      return;
   }

   const content = await readRunOutput(args.runId, stream, tail);

   if (args.json) {
      writeJson({
         content,
         runId: args.runId,
         stream,
         tail
      });
      return;
   }

   if (content.length > 0) {
      process.stdout.write(`${content}\n`);
   }
}
