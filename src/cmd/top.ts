import type { ArgumentsCamelCase, Argv } from "yargs";

import { openTopDashboard } from "../ui/top-screen.js";
import type { RunListFilter } from "../lib/types.js";
export {
   getNextRunFilter,
   getTopDetailScrollWindow,
   getTopEmptyStateHint,
   getTopFilterSummary,
   getTopRunsPaneTitle,
   renderTopMarkdown
} from "../ui/top-screen.js";

type TopArguments = {
   filter?: RunListFilter;
};

export const command = "top";
export const describe = "Open the session dashboard";

export function builder(yargs: Argv): Argv {
   return yargs.option("filter", {
      choices: ["active", "historic", "all"] as const,
      default: "active",
      describe: "Choose the initial run filter",
      type: "string"
   });
}

export async function handler(
   args: ArgumentsCamelCase<TopArguments>
): Promise<void> {
   await openTopDashboard(args.filter ?? "active");
}
