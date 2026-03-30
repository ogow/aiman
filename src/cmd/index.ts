import type { CommandModule } from "yargs";

import * as create from "./create.js";
import * as inspect from "./inspect.js";
import * as list from "./list.js";
import * as run from "./run.js";
import * as show from "./show.js";

export const commands: CommandModule[] = [list, show, create, run, inspect];
