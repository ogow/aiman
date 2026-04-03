import type { Argv, CommandModule } from "yargs";

import * as check from "./profile-check.js";
import * as create from "./profile-create.js";
import * as list from "./profile-list.js";
import * as show from "./profile-show.js";

const profileCommands: CommandModule[] = [list, show, check, create];

export const command = "profile <command>";
export const describe = "Browse and manage profiles";

export function builder(yargs: Argv): Argv {
   return yargs.command(profileCommands).demandCommand();
}

export async function handler(): Promise<void> {}
