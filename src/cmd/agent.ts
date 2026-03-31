import type { Argv, CommandModule } from "yargs";

import * as create from "./create.js";
import * as list from "./list.js";
import * as show from "./show.js";

const agentCommands: CommandModule[] = [list, show, create];

export const command = "agent <command>";
export const describe = "Browse and author specialist agents";

export function builder(yargs: Argv): Argv {
   return yargs.command(agentCommands).demandCommand();
}

export async function handler(): Promise<void> {}
