import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { runDetachedWorker } from "../lib/runs.js";

type InternalRunArguments = {
   runId?: string;
};

export const command = "internal-run <runId>";
export const describe = false;

export function builder(yargs: Argv): Argv {
   return yargs.positional("runId", {
      describe: "Managed run id",
      type: "string"
   });
}

export async function handler(
   args: ArgumentsCamelCase<InternalRunArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   const result = await runDetachedWorker(args.runId);
   process.exitCode = result.status === "success" ? 0 : 1;
}
