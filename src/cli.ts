#!/usr/bin/env bun

import { runCli } from "./lib/cli.js";

const exitCode = await runCli();
process.exit(exitCode);
