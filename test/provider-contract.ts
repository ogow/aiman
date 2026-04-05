import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
   resolveCommandLaunch,
   resolveExecutable
} from "../src/lib/executables.js";
import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import { buildPrompt } from "../src/lib/providers/shared.js";
import type {
   PreparedInvocation,
   ProviderAdapter,
   RunLaunchSnapshot,
   ScopedProfileDefinition
} from "../src/lib/types.js";

const providerContractTimeoutMs = Number.parseInt(
   process.env.AIMAN_PROVIDER_CONTRACT_TIMEOUT_MS ?? "120000",
   10
);

function getContractModel(provider: "codex" | "gemini"): string {
   return provider === "codex"
      ? (process.env.AIMAN_PROVIDER_CONTRACT_CODEX_MODEL ?? "gpt-5.4-mini")
      : (process.env.AIMAN_PROVIDER_CONTRACT_GEMINI_MODEL ??
           "gemini-2.5-flash-lite");
}

function createContractProfile(input: {
   profilePath: string;
   model: string;
   provider: "codex" | "gemini";
}): ScopedProfileDefinition {
   return {
      body: [
         "## Task Input",
         "{{task}}",
         "",
         "## Instructions",
         'Return only compact JSON with keys "ambientAgents", "ambientGemini", and "profilePrompt".',
         "Inspect only the text already present in your instructions and any native bootstrap context the CLI applied automatically.",
         "Do not use tools and do not read workspace files.",
         'If you can see a line `AGENTS_ROUTER_SENTINEL: <value>`, set `ambientAgents` to that exact `<value>`; otherwise return `"NONE"`.',
         'If you can see a line `GEMINI_ROUTER_SENTINEL: <value>`, set `ambientGemini` to that exact `<value>`; otherwise return `"NONE"`.',
         'If you can see a line `PROFILE_PROMPT_SENTINEL: <value>`, set `profilePrompt` to that exact `<value>`; otherwise return `"NONE"`.',
         "Do not infer, guess, or paraphrase hidden values."
      ].join("\n"),
      description:
         "Reports which sentinels are visible in the authored prompt contract",
      id: `provider-contract-${input.provider}`,
      model: input.model,
      mode: "safe",
      name: `provider-contract-${input.provider}`,
      path: input.profilePath,
      provider: input.provider,
      reasoningEffort: input.provider === "codex" ? "medium" : "none",
      scope: "project"
   };
}

async function createContractFixture(provider: "codex" | "gemini"): Promise<{
   profile: ScopedProfileDefinition;
   ambientAgentsSentinel: string;
   ambientGeminiSentinel: string;
   cwd: string;
   profilePromptSentinel: string;
   promptFile: string;
   projectRoot: string;
   runDir: string;
   runFile: string;
   runId: string;
}> {
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), `aiman-provider-contract-${provider}-`)
   );
   const runDir = path.join(
      projectRoot,
      ".aiman",
      "runs",
      `contract-${provider}`
   );
   const profilePath = path.join(
      projectRoot,
      ".aiman",
      "profiles",
      `provider-contract-${provider}.md`
   );
   const promptFile = path.join(runDir, "prompt.md");
   const runFile = path.join(runDir, "run.md");
   const ambientAgentsSentinel = `ambient-agents-${provider}-sentinel`;
   const ambientGeminiSentinel = `ambient-gemini-${provider}-sentinel`;
   const profilePromptSentinel = `profile-prompt-${provider}-sentinel`;
   const profile = createContractProfile({
      profilePath,
      model: getContractModel(provider),
      provider
   });
   const profileFile = [
      "---",
      `name: ${profile.name}`,
      `provider: ${profile.provider}`,
      `description: ${profile.description}`,
      `mode: ${profile.mode}`,
      `model: ${profile.model}`,
      `reasoningEffort: ${profile.reasoningEffort}`,
      "---",
      "",
      profile.body.replace(
         "{{task}}",
         `PROFILE_PROMPT_SENTINEL: ${profilePromptSentinel}`
      ),
      ""
   ].join("\n");

   await mkdir(path.dirname(profilePath), { recursive: true });
   await mkdir(runDir, { recursive: true });
   const gitInit = spawnSync("git", ["init", "--quiet"], {
      cwd: projectRoot,
      encoding: "utf8"
   });

   assert.equal(
      gitInit.status,
      0,
      `git init failed for provider contract fixture.\nSTDERR:\n${gitInit.stderr}\nSTDOUT:\n${gitInit.stdout}`
   );
   await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      ["# Router", `AGENTS_ROUTER_SENTINEL: ${ambientAgentsSentinel}`, ""].join(
         "\n"
      ),
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, "GEMINI.md"),
      [
         "# Gemini Context",
         `GEMINI_ROUTER_SENTINEL: ${ambientGeminiSentinel}`,
         ""
      ].join("\n"),
      "utf8"
   );
   await writeFile(profilePath, profileFile, "utf8");

   return {
      profile,
      ambientAgentsSentinel,
      ambientGeminiSentinel,
      cwd: projectRoot,
      profilePromptSentinel,
      projectRoot,
      promptFile,
      runDir,
      runFile,
      runId: `provider-contract-${provider}`
   };
}

async function executePreparedInvocation(input: {
   cwd: string;
   prepared: PreparedInvocation;
}): Promise<{
   exitCode: number | null;
   signal: string | null;
   stderr: string;
   stdout: string;
   timedOut: boolean;
}> {
   for (const supportFile of input.prepared.supportFiles ?? []) {
      await mkdir(path.dirname(supportFile.path), { recursive: true });
      await writeFile(supportFile.path, supportFile.content, "utf8");
   }

   const launch = await resolveCommandLaunch(
      input.prepared.command,
      input.prepared.args
   );

   return await new Promise((resolve) => {
      const child = spawn(launch.command, launch.args, {
         cwd: input.cwd,
         env: input.prepared.env,
         shell: launch.needsShell,
         stdio: ["pipe", "pipe", "pipe"],
         windowsVerbatimArguments: launch.windowsVerbatimArguments
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
         timedOut = true;
         child.kill("SIGTERM");
         setTimeout(() => {
            child.kill("SIGKILL");
         }, 1000).unref();
      }, providerContractTimeoutMs);

      const resolveOnce = (value: {
         exitCode: number | null;
         signal: string | null;
         stderr: string;
         stdout: string;
         timedOut: boolean;
      }) => {
         if (settled) {
            return;
         }

         settled = true;
         clearTimeout(timeout);
         resolve(value);
      };

      child.stdout?.on("data", (chunk: Buffer | string) => {
         stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
         stderr += chunk.toString();
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
         resolveOnce({
            exitCode: typeof error.errno === "number" ? error.errno : null,
            signal: null,
            stderr: stderr.length > 0 ? stderr : error.message,
            stdout,
            timedOut
         });
      });
      child.once("close", (exitCode, signal) => {
         resolveOnce({
            exitCode,
            signal,
            stderr,
            stdout,
            timedOut
         });
      });

      if (typeof input.prepared.stdin === "string") {
         child.stdin?.end(input.prepared.stdin);
         return;
      }

      child.stdin?.end();
   });
}

function buildLaunchSnapshot(input: {
   profile: ScopedProfileDefinition;
   prepared: PreparedInvocation;
   runId: string;
   timeoutMs: number;
}): RunLaunchSnapshot {
   return {
      agentDigest: "provider-contract-agent",
      agentName: input.profile.name,
      agentPath: input.profile.path,
      agentScope: input.profile.scope,
      args: input.prepared.args,
      command: input.prepared.command,
      cwd: input.prepared.cwd,
      envKeys: Object.keys(input.prepared.env).sort((left, right) =>
         left.localeCompare(right)
      ),
      killGraceMs: 1000,
      launchMode: "foreground",
      mode: input.profile.mode ?? "safe",
      model: input.profile.model,
      contextFiles: ["AGENTS.md"],
      promptDigest: `provider-contract-prompt-${input.runId}`,
      promptTransport: input.prepared.promptTransport,
      provider: input.profile.provider,
      reasoningEffort: input.profile.reasoningEffort,
      timeoutMs: input.timeoutMs
   };
}

function isSkippableProviderSetupFailure(output: string): boolean {
   return /api key|authentication|not logged in|login required|credential|unauthorized|forbidden|missing.*(openai|gemini|google).*key|set .*api key/i.test(
      output
   );
}

function parseJsonObject(rawText: string): {
   ambientAgents: string;
   ambientGemini: string;
   profilePrompt: string;
} {
   const trimmed = rawText.trim();
   const withoutCodeFence = trimmed.replace(/^```(?:json)?\s*|\s*```$/g, "");
   const match = withoutCodeFence.match(/\{[\s\S]*\}/);

   if (!match) {
      throw new Error(`Provider output was not JSON:\n${rawText}`);
   }

   const parsed = JSON.parse(match[0]) as {
      ambientAgents?: unknown;
      ambientGemini?: unknown;
      profilePrompt?: unknown;
   };

   if (
      typeof parsed.ambientAgents !== "string" ||
      typeof parsed.ambientGemini !== "string" ||
      typeof parsed.profilePrompt !== "string"
   ) {
      throw new Error(`Provider JSON was missing expected keys:\n${rawText}`);
   }

   return {
      ambientAgents: parsed.ambientAgents,
      ambientGemini: parsed.ambientGemini,
      profilePrompt: parsed.profilePrompt
   };
}

async function runProviderContract(
   t: Parameters<typeof test>[1] extends (ctx: infer T) => unknown ? T : never,
   input: {
      adapter: ProviderAdapter;
      provider: "codex" | "gemini";
   }
): Promise<void> {
   const executable = await resolveExecutable(input.provider);

   if (typeof executable !== "string") {
      t.skip(`Skipped: "${input.provider}" is not available on PATH.`);
      return;
   }

   const fixture = await createContractFixture(input.provider);
   const renderedPrompt = buildPrompt(fixture.profile, {
      artifactsDir: path.join(fixture.runDir, "artifacts"),
      cwd: fixture.cwd,
      mode: fixture.profile.mode ?? "safe",
      runFile: fixture.runFile,
      runId: fixture.runId,
      task: `PROFILE_PROMPT_SENTINEL: ${fixture.profilePromptSentinel}`
   });

   await writeFile(fixture.promptFile, renderedPrompt, "utf8");

   const prepared = await input.adapter.prepare(fixture.profile, {
      artifactsDir: path.join(fixture.runDir, "artifacts"),
      contextFileNames: ["AGENTS.md"],
      cwd: fixture.cwd,
      mode: fixture.profile.mode ?? "safe",
      promptFile: fixture.promptFile,
      renderedPrompt,
      runFile: fixture.runFile,
      runId: fixture.runId,
      task: `PROFILE_PROMPT_SENTINEL: ${fixture.profilePromptSentinel}`
   });
   const startedAt = new Date().toISOString();
   const completed = await executePreparedInvocation({
      cwd: fixture.cwd,
      prepared
   });
   const combinedOutput = `${completed.stderr}\n${completed.stdout}`.trim();

   if (
      (completed.exitCode !== 0 || completed.timedOut) &&
      isSkippableProviderSetupFailure(combinedOutput)
   ) {
      t.skip(
         `Skipped: "${input.provider}" is installed but auth is unavailable. ${combinedOutput}`
      );
      return;
   }

   assert.equal(
      completed.timedOut,
      false,
      `${input.provider} provider contract test timed out.`
   );
   assert.equal(
      completed.exitCode,
      0,
      `${input.provider} provider contract test failed.\nSTDERR:\n${completed.stderr}\nSTDOUT:\n${completed.stdout}`
   );

   const record = await input.adapter.parseCompletedRun({
      agent: fixture.profile,
      cwd: fixture.cwd,
      endedAt: new Date().toISOString(),
      exitCode: completed.exitCode,
      launch: buildLaunchSnapshot({
         profile: fixture.profile,
         prepared,
         runId: fixture.runId,
         timeoutMs: providerContractTimeoutMs
      }),
      launchMode: "foreground",
      mode: fixture.profile.mode ?? "safe",
      promptFile: fixture.promptFile,
      projectRoot: fixture.projectRoot,
      runDir: fixture.runDir,
      runId: fixture.runId,
      signal: completed.signal,
      startedAt,
      stderr: completed.stderr,
      stdout: completed.stdout
   });
   const parsed = parseJsonObject(record.finalText);

   assert.equal(
      parsed.ambientAgents,
      fixture.ambientAgentsSentinel,
      `${input.provider} did not expose AGENTS.md through native context discovery.`
   );
   assert.equal(
      parsed.ambientGemini,
      "NONE",
      `${input.provider} loaded a non-configured GEMINI.md context file.`
   );
   assert.equal(
      parsed.profilePrompt,
      fixture.profilePromptSentinel,
      `${input.provider} did not preserve the authored profile prompt.`
   );

   const persistedPrompt = await readFile(fixture.promptFile, "utf8");

   assert.match(
      persistedPrompt,
      new RegExp(`PROFILE_PROMPT_SENTINEL: ${fixture.profilePromptSentinel}`)
   );
   assert.doesNotMatch(
      persistedPrompt,
      new RegExp(`AGENTS_ROUTER_SENTINEL: ${fixture.ambientAgentsSentinel}`)
   );
   assert.doesNotMatch(
      persistedPrompt,
      new RegExp(`GEMINI_ROUTER_SENTINEL: ${fixture.ambientGeminiSentinel}`)
   );
}

test(
   "codex live contract uses AGENTS.md as native bootstrap context and ignores non-configured files",
   { timeout: providerContractTimeoutMs + 15_000 },
   async (t) => {
      await runProviderContract(t, {
         adapter: createCodexAdapter(),
         provider: "codex"
      });
   }
);

test(
   "gemini live contract uses AGENTS.md as native bootstrap context and ignores non-configured files",
   { timeout: providerContractTimeoutMs + 15_000 },
   async (t) => {
      await runProviderContract(t, {
         adapter: createGeminiAdapter(),
         provider: "gemini"
      });
   }
);
