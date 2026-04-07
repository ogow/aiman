#!/usr/bin/env bun

/**
 * The Planner-Generator-Evaluator Blueprint Loop
 *
 * This standalone script demonstrates the 5 Principles of Effective Orchestration:
 * 1. Interleaving Deterministic & Agentic Nodes
 * 2. Specialized Personas (Planner, Generator, Evaluator)
 * 3. Context Resets (Fresh agent per run instead of a long chat thread)
 * 4. Capped Self-Correction (Max 2 test retries)
 * 5. State managed via the File System (Prompt.md -> Plan.md -> Code)
 *
 * Usage:
 *   bun run examples/blueprint-loop.ts "Feature request description..."
 */

import { createAiman } from "../src/index.js";
import { execSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import chalk from "chalk";

const userGoal = process.argv[2];

if (!userGoal) {
   console.log('Usage: bun run blueprint-loop.ts "<feature description>"');
   process.exit(1);
}

const MAX_RETRIES = 2; // Principle 4: Cap the Self-Correction Loop

async function runBlueprint() {
   const aiman = await createAiman();

   // --- 1. The Planner Node (Agentic) ---
   console.log(chalk.blue(`\n[Planner] Expanding goal into Plan.md...`));

   // We save the user prompt to disk (Principle 3: Durable Memory)
   await writeFile("Prompt.md", userGoal, "utf8");

   const planResult = await aiman.runs.run("plan", {
      task: "Read Prompt.md and expand the feature request into a strict list of milestones. Write this to Plan.md. Do not write any code.",
      onRunStarted: (run) => console.log(chalk.dim(`  Run ID: ${run.runId}`))
   });

   if (planResult.status !== "success") {
      console.log(chalk.red(`Planner failed: ${planResult.error?.message}`));
      process.exit(1);
   }
   console.log(chalk.green(`  Done. Plan written.`));

   // --- 2. The Generator Node (Agentic) ---
   console.log(chalk.blue(`\n[Generator] Implementing Plan.md...`));

   const genResult = await aiman.runs.run("build", {
      task: "Read Plan.md and implement the requested feature. Ensure tests are also updated or created.",
      onRunStarted: (run) => console.log(chalk.dim(`  Run ID: ${run.runId}`))
   });

   if (genResult.status !== "success") {
      console.log(chalk.red(`Generator failed: ${genResult.error?.message}`));
      process.exit(1);
   }
   console.log(chalk.green(`  Done. Code written.`));

   // --- 3. The Evaluator Node (Deterministic + Agentic) ---
   console.log(
      chalk.blue(`\n[Evaluator] Running deterministic tests & fast linters...`)
   );

   let attempt = 0;
   let testsPassed = false;

   while (attempt <= MAX_RETRIES) {
      if (attempt > 0) {
         console.log(
            chalk.yellow(
               `\n--- Self-Correction Attempt ${attempt}/${MAX_RETRIES} ---`
            )
         );
      }

      try {
         // Deterministic Node: Shift feedback left with fast local commands
         execSync("bun run lint", { encoding: "utf8", stdio: "pipe" });
         execSync("bun test", { encoding: "utf8", stdio: "pipe" });

         testsPassed = true;
         console.log(chalk.green(`  [QA] All tests passed! Feature complete.`));
         break;
      } catch (error: any) {
         const testOutput = error.stdout + "\n" + error.stderr;
         console.log(chalk.red(`  [QA] Tests failed. Log saved to Error.md.`));
         await writeFile("Error.md", testOutput, "utf8");

         if (attempt === MAX_RETRIES) {
            console.log(
               chalk.red.bold(
                  `\n[HALT] Maximum retries reached. Escalating to human review.`
               )
            );
            break;
         }

         // Context Reset: We don't append to a long chat. We spin up a *fresh* agent
         // that simply reads Error.md and Plan.md to fix the code with zero "context rot".
         console.log(
            chalk.blue(`[Generator] Fixing code based on Error.md...`)
         );
         const fixResult = await aiman.runs.run("build", {
            task: "Read Error.md and Plan.md. Fix the failing code or tests so that they pass. Do not introduce new features.",
            onRunStarted: (run) =>
               console.log(chalk.dim(`  Run ID: ${run.runId}`))
         });

         if (fixResult.status !== "success") {
            console.log(
               chalk.red(
                  `Fix attempt failed fundamentally: ${fixResult.error?.message}`
               )
            );
            break;
         }
      }
      attempt++;
   }

   if (testsPassed) {
      console.log(
         chalk.green.bold(
            `\nBlueprint execution successful. Code is ready for review.`
         )
      );
   } else {
      process.exit(1);
   }
}

runBlueprint().catch(console.error);
