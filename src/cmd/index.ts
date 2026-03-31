import type { CommandModule } from "yargs";

import * as agent from "./agent.js";
import * as internalRun from "./internal-run.js";
import * as run from "./run.js";
import * as sesh from "./sesh.js";
import * as skill from "./skill.js";

export const commands: CommandModule[] = [
   agent,
   skill,
   run,
   sesh,
   internalRun
];
