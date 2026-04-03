import type { Argv, CommandModule } from "yargs";

import * as check from "./check-agent.js";
import * as create from "./create.js";
import * as list from "./list.js";
import * as show from "./show.js";
import * as stop from "./stop-agent.js";

const agentCommands: CommandModule[] = [list, show, check, create, stop];

export const command = "agent <command>";
export const describe = "Browse and author specialist agents";

export function builder(yargs: Argv): Argv {
   return yargs.command(agentCommands).demandCommand();
}

export async function handler(): Promise<void> {}
