import type { Argv, CommandModule } from "yargs";

import * as list from "./skills.js";

const skillCommands: CommandModule[] = [list];

export const command = "skill <command>";
export const describe = "Browse available skills";

export function builder(yargs: Argv): Argv {
   return yargs.command(skillCommands).demandCommand();
}

export async function handler(): Promise<void> {}
