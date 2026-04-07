#!/usr/bin/env bun

/**
 * Ralph Wiggum Loop - A standalone orchestration script.
 *
 * This script demonstrates how to run an agent in a loop where the agent
 * itself suggests the next task.
 *
 * Usage:
 *   bun run examples/ralph-loop.ts <agent> <initial-task>
 */

import { createAiman } from "../src/index.js";
import chalk from "chalk";

const [agentName, initialTask] = process.argv.slice(2);

if (!agentName || !initialTask) {
   console.log("Usage: bun run ralph-loop.ts <agent> <initial-task>");
   process.exit(1);
}

async function runLoop() {
   const aiman = await createAiman();
   let currentTask = initialTask;
   let iteration = 0;
   const limit = 5;

   console.log(chalk.blue(`\nStarting loop with agent: ${agentName}`));
   console.log(chalk.dim(`Initial task: ${currentTask}\n`));

   while (iteration < limit) {
      iteration++;
      console.log(chalk.yellow(`--- Iteration ${iteration}/${limit} ---`));

      const result = await aiman.runs.run(agentName, {
         task: currentTask,
         onRunStarted: (run) => {
            console.log(chalk.dim(`Run started: ${run.runId}`));
         }
      });

      if (result.status !== "success") {
         console.log(chalk.red(`Run failed with status: ${result.status}`));
         break;
      }

      console.log(chalk.green(`\nSummary: ${result.summary}`));

      // If the agent suggested a next task, continue the loop
      if (result.handoff?.nextTask) {
         console.log(
            chalk.blue(`Next task suggested: ${result.handoff.nextTask}`)
         );
         currentTask = result.handoff.nextTask;
      } else {
         console.log(
            chalk.green(`\nLoop completed: No further tasks suggested.`)
         );
         break;
      }
   }
}

runLoop().catch(console.error);
