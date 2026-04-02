import type { Argv, CommandModule } from "yargs";

import * as inspect from "./inspect.js";
import * as list from "./ps.js";
import * as logs from "./logs.js";
import * as show from "./status.js";
import * as top from "./top.js";

const seshCommands: CommandModule[] = [list, show, logs, inspect, top];

export const command = "sesh <command>";
export const describe = "Inspect live and recorded sessions";

export function builder(yargs: Argv): Argv {
   return yargs.command(seshCommands).demandCommand();
}

export async function handler(): Promise<void> {}
