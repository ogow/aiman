import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderSection, renderTable } from "../lib/pretty.js";
import type { RunInspection } from "../lib/types.js";

type StopArguments = {
   json?: boolean;
   runId?: string;
};

export const command = "stop <runId>";
export const describe = "Stop one active run by id";

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

function describeStopResult(run: RunInspection): string {
   if (run.status === "running" && run.active) {
      return "stopping";
   }

   return run.status;
}

function renderStopSummary(stoppedRuns: RunInspection[]): string {
   return renderSection(
      "Stopped runs",
      renderTable(
         ["Run ID", "Agent", "Scope", "State"],
         stoppedRuns.map((run) => [
            run.runId,
            run.agent,
            run.agentScope,
            describeStopResult(run)
         ])
      )
   );
}

export async function handler(
   args: ArgumentsCamelCase<StopArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   const stoppedRun = await (await createAiman()).runs.stop(args.runId);

   if (args.json) {
      writeJson({
         stoppedRun
      });
      return;
   }

   process.stdout.write(`${renderStopSummary([stoppedRun])}\n`);
}
