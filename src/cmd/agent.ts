import type { Argv, CommandModule } from "yargs";

import * as check from "./agent-check.js";
import * as create from "./agent-create.js";
import * as list from "./agent-list.js";
import * as show from "./agent-show.js";

const agentCommands: CommandModule[] = [list, show, check, create];

export const command = "agent <command>";
export const describe = "Browse and manage agents";

export function builder(yargs: Argv): Argv {
   return yargs.command(agentCommands).demandCommand();
}

export async function handler(): Promise<void> {}
