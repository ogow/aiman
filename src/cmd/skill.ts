import type { Argv, CommandModule } from "yargs";

import * as check from "./skill-check.js";
import * as list from "./skills.js";
import * as show from "./skill-show.js";

const skillCommands: CommandModule[] = [list, show, check];

export const command = "skill <command>";
export const describe = "Browse local aiman skills";

export function builder(yargs: Argv): Argv {
   return yargs.command(skillCommands).demandCommand();
}

export async function handler(): Promise<void> {}
