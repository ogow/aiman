import type { CommandModule } from "yargs";

import * as agent from "./agent.js";
import * as internalRun from "./internal-run.js";
import * as run from "./run.js";
import * as runs from "./runs.js";

export const commands: CommandModule[] = [agent, run, runs, internalRun];
