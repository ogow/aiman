import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderSection, renderTable } from "../lib/pretty.js";
import { stopRun } from "../lib/runs.js";
import type { RunInspection } from "../lib/types.js";

type StopArguments = {
   id?: string;
   json?: boolean;
};

export const command = "stop <id>";
export const describe = "Stop one active run by id";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("id", {
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
            run.profile ?? run.agent ?? "",
            run.profileScope ?? run.agentScope ?? "",
            describeStopResult(run)
         ])
      )
   );
}

export async function handler(
   args: ArgumentsCamelCase<StopArguments>
): Promise<void> {
   if (typeof args.id !== "string" || args.id.length === 0) {
      throw new UserError("Run id is required.");
   }

   const stoppedRun = await stopRun(args.id);

   if (args.json) {
      writeJson({
         stoppedRun
      });
      return;
   }

   process.stdout.write(`${renderStopSummary([stoppedRun])}\n`);
}
