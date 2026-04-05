import type { Argv, CommandModule } from "yargs";

import * as inspect from "./run-inspect.js";
import * as list from "./run-list.js";
import * as logs from "./run-logs.js";
import * as show from "./run-show.js";
import * as stop from "./run-stop.js";

const runsCommands: CommandModule[] = [list, show, logs, inspect, stop];

export const command = "runs <command>";
export const describe = "Browse and manage agent runs";

export function builder(yargs: Argv): Argv {
   return yargs.command(runsCommands).demandCommand();
}

export async function handler(): Promise<void> {}
