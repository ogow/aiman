#!/usr/bin/env bun

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import chalk from "chalk";

import { createAiman } from "../src/index.js";
import { resolveExecutable } from "../src/lib/executables.js";

import type { ProviderId, ReasoningEffort } from "../src/lib/types.js";

type ConfigSmokeFixture = {
   agentName: string;
   capabilities: string[];
   configuredContextFiles: string[];
   extraContextSentinel: string;
   ignoredContextSentinel: string;
   model: string;
   projectRoot: string;
   provider: ProviderId;
   reasoningEffort: ReasoningEffort;
   runCwd: string;
   taskSentinel: string;
};

type StructuredSmokeResult = {
   visibleAgents: string;
   visibleExtra: string;
   visibleIgnored: string;
   visibleTask: string;
};

function usage(): never {
   console.log("Usage: bun run examples/config-smoke.ts [codex|gemini|all]");
   process.exit(1);
}

function parseProviders(argv: string[]): ProviderId[] {
   const selection = argv[0] ?? "all";

   if (selection === "all") {
      return ["codex", "gemini"];
   }

   if (selection === "codex" || selection === "gemini") {
      return [selection];
   }

   usage();
}

function getModel(provider: ProviderId): string {
   return provider === "codex"
      ? (process.env.AIMAN_CONFIG_SMOKE_CODEX_MODEL ?? "gpt-5.4-mini")
      : (process.env.AIMAN_CONFIG_SMOKE_GEMINI_MODEL ??
           "gemini-2.5-flash-lite");
}

function getReasoningEffort(provider: ProviderId): ReasoningEffort {
   return provider === "codex" ? "medium" : "none";
}

function isSkippableProviderSetupFailure(output: string): boolean {
   return /api key|authentication|not logged in|login required|credential|unauthorized|forbidden|missing.*(openai|gemini|google).*key|set .*api key/i.test(
      output
   );
}

function getCodexFallbackConfigArg(contextFileNames: string[]): string {
   return `project_doc_fallback_filenames=${JSON.stringify(
      contextFileNames.filter((fileName) => fileName !== "AGENTS.md")
   )}`;
}

function getAgentMarkdown(input: {
   agentName: string;
   capabilities: string[];
   model: string;
   provider: ProviderId;
   reasoningEffort: ReasoningEffort;
}): string {
   return [
      "---",
      `name: ${input.agentName}`,
      `provider: ${input.provider}`,
      "description: Verifies that authored agent config is applied during a real run.",
      `model: ${input.model}`,
      `reasoningEffort: ${input.reasoningEffort}`,
      "resultMode: schema",
      "capabilities:",
      ...input.capabilities.map((capability) => `  - ${capability}`),
      "---",
      "",
      "## Role",
      "You verify which runtime configuration is actually visible and applied.",
      "",
      "## Task Input",
      "{{task}}",
      "",
      "## Instructions",
      '- Set `summary` to `"config smoke"`.',
      '- Set `outcome` to `"verified"`.',
      "- Set `result` to an object with string keys `visibleAgents`, `visibleExtra`, `visibleIgnored`, and `visibleTask`.",
      "- Inspect only the text already present in your instructions and any native bootstrap context the CLI applied automatically.",
      "- Do not use tools and do not read workspace files.",
      '- If you can see `AGENTS_CONTEXT_SENTINEL: <value>`, set `visibleAgents` to that exact `<value>`; otherwise return `"NONE"`.',
      '- If you can see `EXTRA_CONTEXT_SENTINEL: <value>`, set `visibleExtra` to that exact `<value>`; otherwise return `"NONE"`.',
      '- If you can see `IGNORED_CONTEXT_SENTINEL: <value>`, set `visibleIgnored` to that exact `<value>`; otherwise return `"NONE"`.',
      '- If you can see `TASK_PROMPT_SENTINEL: <value>`, set `visibleTask` to that exact `<value>`; otherwise return `"NONE"`.',
      "- Do not infer, guess, or paraphrase hidden values.",
      "",
      "## Constraints",
      "- Work only from the prompt and native bootstrap context already attached to this run.",
      "- Do not browse the repo or open files yourself.",
      "",
      "## Stop Conditions",
      "- Stop once you can fill every required result field from visible evidence or mark it as NONE.",
      "- Stop with the required JSON only.",
      "",
      "## Expected Output",
      "- Return only the required schema-mode JSON response."
   ].join("\n");
}

async function createFixture(
   provider: ProviderId
): Promise<ConfigSmokeFixture> {
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), `aiman-config-smoke-${provider}-`)
   );
   const runCwd = path.join(projectRoot, "workspace", "nested");
   const agentName = `config-smoke-${provider}`;
   const configuredContextFiles = ["AGENTS.md", "CONFIG_SMOKE.md"];
   const capabilities = [
      "Reports visible native bootstrap context sentinels",
      "Confirms runtime launch metadata for authored agent config"
   ];
   const taskSentinel = `task-${provider}-sentinel`;
   const reasoningEffort = getReasoningEffort(provider);
   const model = getModel(provider);
   const extraContextSentinel = `extra-${provider}-sentinel`;
   const ignoredContextSentinel = `ignored-${provider}-sentinel`;
   const gitInit = spawnSync("git", ["init", "--quiet"], {
      cwd: projectRoot,
      encoding: "utf8"
   });

   assert.equal(
      gitInit.status,
      0,
      `git init failed for ${provider} config smoke fixture.\nSTDERR:\n${gitInit.stderr}\nSTDOUT:\n${gitInit.stdout}`
   );

   await mkdir(path.join(projectRoot, ".aiman", "agents"), {
      recursive: true
   });
   await mkdir(runCwd, { recursive: true });
   await writeFile(
      path.join(projectRoot, ".aiman", "config.json"),
      JSON.stringify({ contextFileNames: configuredContextFiles }, null, 2),
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      [
         "# Router",
         `AGENTS_CONTEXT_SENTINEL: agents-${provider}-sentinel`,
         ""
      ].join("\n"),
      "utf8"
   );
   await writeFile(
      path.join(runCwd, "CONFIG_SMOKE.md"),
      [
         "# Extra Context",
         `EXTRA_CONTEXT_SENTINEL: ${extraContextSentinel}`,
         ""
      ].join("\n"),
      "utf8"
   );
   await writeFile(
      path.join(runCwd, "IGNORED.md"),
      [
         "# Ignored Context",
         `IGNORED_CONTEXT_SENTINEL: ${ignoredContextSentinel}`,
         ""
      ].join("\n"),
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", `${agentName}.md`),
      getAgentMarkdown({
         agentName,
         capabilities,
         model,
         provider,
         reasoningEffort
      }),
      "utf8"
   );

   return {
      agentName,
      capabilities,
      configuredContextFiles,
      extraContextSentinel,
      ignoredContextSentinel,
      model,
      projectRoot,
      provider,
      reasoningEffort,
      runCwd,
      taskSentinel
   };
}

function parseStructuredSmokeResult(value: unknown): StructuredSmokeResult {
   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("structuredResult must be an object.");
   }

   const record = value as Record<string, unknown>;
   const visibleAgents = record.visibleAgents;
   const visibleExtra = record.visibleExtra;
   const visibleIgnored = record.visibleIgnored;
   const visibleTask = record.visibleTask;

   if (
      typeof visibleAgents !== "string" ||
      typeof visibleExtra !== "string" ||
      typeof visibleIgnored !== "string" ||
      typeof visibleTask !== "string"
   ) {
      throw new Error(
         "structuredResult must include string keys visibleAgents, visibleExtra, visibleIgnored, and visibleTask."
      );
   }

   return {
      visibleAgents,
      visibleExtra,
      visibleIgnored,
      visibleTask
   };
}

async function readOptionalFile(filePath: string): Promise<string> {
   try {
      return await readFile(filePath, "utf8");
   } catch {
      return "";
   }
}

async function verifyProvider(provider: ProviderId): Promise<"pass" | "skip"> {
   const executable = await resolveExecutable(provider);

   if (typeof executable !== "string") {
      console.log(chalk.yellow(`SKIP  ${provider} not found on PATH`));
      return "skip";
   }

   const fixture = await createFixture(provider);
   const aiman = await createAiman({ projectRoot: fixture.projectRoot });

   assert.deepEqual(
      aiman.config.contextFileNames,
      fixture.configuredContextFiles
   );

   const check = await aiman.agents.check(fixture.agentName, "project");
   assert.equal(
      check.status,
      "ok",
      `agent check failed for ${provider}: ${JSON.stringify(check, null, 2)}`
   );

   const runResult = await aiman.runs.run(fixture.agentName, {
      agentScope: "project",
      cwd: fixture.runCwd,
      task: `TASK_PROMPT_SENTINEL: ${fixture.taskSentinel}`
   });

   if (runResult.status !== "success") {
      const inspection = await aiman.runs.get(runResult.runId);
      const stdout = await readOptionalFile(inspection.paths.stdoutLog);
      const stderr = await readOptionalFile(inspection.paths.stderrLog);
      const combinedOutput = [
         runResult.error?.message ?? "",
         stdout,
         stderr
      ].join("\n");

      if (isSkippableProviderSetupFailure(combinedOutput)) {
         console.log(
            chalk.yellow(
               `SKIP  ${provider} auth unavailable: ${combinedOutput.trim() || "provider credentials missing"}`
            )
         );
         return "skip";
      }

      throw new Error(
         `${provider} config smoke run ${runResult.runId} failed.\n${combinedOutput.trim()}`
      );
   }

   try {
      const inspection = await aiman.runs.get(runResult.runId);
      const parsed = parseStructuredSmokeResult(inspection.structuredResult);
      const prompt = inspection.launch.renderedPrompt;

      assert.equal(inspection.status, "success");
      assert.equal(inspection.resultMode, "schema");
      assert.equal(inspection.summary, "config smoke");
      assert.equal(inspection.outcome, "verified");
      assert.equal(inspection.provider, provider);
      assert.equal(inspection.launch.provider, provider);
      assert.equal(inspection.launch.cwd, fixture.runCwd);
      assert.equal(inspection.launch.model, fixture.model);
      assert.equal(inspection.launch.reasoningEffort, fixture.reasoningEffort);
      assert.equal(inspection.launch.resultMode, "schema");
      assert.deepEqual(
         inspection.launch.contextFiles,
         fixture.configuredContextFiles
      );
      assert.deepEqual(inspection.launch.capabilities, fixture.capabilities);
      assert.equal(parsed.visibleAgents, `agents-${provider}-sentinel`);
      assert.equal(parsed.visibleExtra, fixture.extraContextSentinel);
      assert.equal(parsed.visibleIgnored, "NONE");
      assert.equal(parsed.visibleTask, fixture.taskSentinel);
      assert.equal(
         prompt.includes(`TASK_PROMPT_SENTINEL: ${fixture.taskSentinel}`),
         true
      );
      assert.equal(prompt.includes(`agents-${provider}-sentinel`), false);
      assert.equal(prompt.includes(fixture.extraContextSentinel), false);
      assert.equal(prompt.includes(fixture.ignoredContextSentinel), false);

      if (provider === "codex") {
         assert.equal(
            inspection.launch.args.includes(
               getCodexFallbackConfigArg(fixture.configuredContextFiles)
            ),
            true
         );
         assert.match(
            inspection.launch.args.join("\n"),
            /approval_policy="never"/
         );
         assert.match(
            inspection.launch.args.join("\n"),
            /model_reasoning_effort=medium/
         );
      } else {
         assert.match(inspection.launch.args.join("\n"), /--output-format/);
         assert.match(inspection.launch.args.join("\n"), /json/);
         assert.match(inspection.launch.args.join("\n"), /--approval-mode/);
         assert.match(inspection.launch.args.join("\n"), /yolo/);
         assert.match(
            inspection.launch.envKeys.join("\n"),
            /GEMINI_CLI_SYSTEM_SETTINGS_PATH/
         );

         const overlay = JSON.parse(
            await readFile(
               path.join(
                  inspection.paths.runDir,
                  ".gemini-system-settings.json"
               ),
               "utf8"
            )
         ) as { context?: { fileName?: unknown } };

         assert.deepEqual(
            overlay.context?.fileName,
            fixture.configuredContextFiles
         );
      }
   } catch (error) {
      throw new Error(
         `${provider} config smoke assertions failed for run ${runResult.runId}: ${
            error instanceof Error ? error.message : String(error)
         }`
      );
   }

   console.log(chalk.green(`PASS  ${provider} config smoke`));
   console.log(chalk.dim(`  runId: ${runResult.runId}`));
   return "pass";
}

async function main() {
   const providers = parseProviders(process.argv.slice(2));
   let passed = 0;
   let failed = 0;
   let skipped = 0;

   for (const provider of providers) {
      try {
         const outcome = await verifyProvider(provider);

         if (outcome === "pass") {
            passed += 1;
         } else {
            skipped += 1;
         }
      } catch (error) {
         failed += 1;
         console.log(
            chalk.red(
               `FAIL  ${provider} ${
                  error instanceof Error ? error.message : String(error)
               }`
            )
         );
      }
   }

   console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed.`);

   if (failed > 0) {
      process.exit(1);
   }
}

main().catch((error) => {
   console.error(error instanceof Error ? error.message : String(error));
   process.exit(1);
});
