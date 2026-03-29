#!/usr/bin/env node

import { runCli } from "./lib/cli.js";

const exitCode = await runCli();
process.exit(exitCode);
