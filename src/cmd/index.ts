import type { CommandModule } from "yargs";

import * as internalRun from "./internal-run.js";
import * as profile from "./profile.js";
import * as run from "./run.js";
import * as sesh from "./sesh.js";
import * as skill from "./skill.js";

export const commands: CommandModule[] = [profile, skill, run, sesh, internalRun];
