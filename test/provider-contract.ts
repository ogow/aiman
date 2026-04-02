import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { resolveCommandLaunch, resolveExecutable } from "../src/lib/executables.js";
import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import { buildPrompt } from "../src/lib/providers/shared.js";
import type {
   PreparedInvocation,
   PromptContextFile,
   ProviderAdapter,
   RunLaunchSnapshot,
   ScopedAgentDefinition
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

function createContractAgent(input: {
   agentPath: string;
   model: string;
   provider: "codex" | "gemini";
}): ScopedAgentDefinition {
   return {
      body: [
         "## Task Input",
         "{{task}}",
         "",
         "## Instructions",
         'Return only compact JSON with keys "ambientAgents", "ambientGemini", and "baseline".',
         "Inspect only the text already present in your instructions and attached project context.",
         "Do not use tools and do not read workspace files.",
         'If you can see a line `AGENTS_ROUTER_SENTINEL: <value>`, set `ambientAgents` to that exact `<value>`; otherwise return `"NONE"`.',
         'If you can see a line `GEMINI_ROUTER_SENTINEL: <value>`, set `ambientGemini` to that exact `<value>`; otherwise return `"NONE"`.',
         'If you can see a line `BASELINE_CONTEXT_SENTINEL: <value>`, set `baseline` to that exact `<value>`; otherwise return `"NONE"`.',
         "Do not infer, guess, or paraphrase hidden values."
      ].join("\n"),
      contextFiles: ["docs/agent-baseline.md"],
      description:
         "Reports which sentinels are visible in the authored prompt contract",
      id: `provider-contract-${input.provider}`,
      model: input.model,
      name: `provider-contract-${input.provider}`,
      path: input.agentPath,
      permissions: "read-only",
      provider: input.provider,
      scope: "project"
   };
}

async function createContractFixture(provider: "codex" | "gemini"): Promise<{
   agent: ScopedAgentDefinition;
   ambientAgentsSentinel: string;
   ambientGeminiSentinel: string;
   baselineContext: PromptContextFile;
   baselineSentinel: string;
   cwd: string;
   promptFile: string;
   projectRoot: string;
   runDir: string;
   runFile: string;
   runId: string;
}> {
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), `aiman-provider-contract-${provider}-`)
   );
   const runDir = path.join(projectRoot, ".aiman", "runs", `contract-${provider}`);
   const agentPath = path.join(
      projectRoot,
      ".aiman",
      "agents",
      `provider-contract-${provider}.md`
   );
   const promptFile = path.join(runDir, "prompt.md");
   const runFile = path.join(runDir, "run.md");
   const baselineFile = path.join(projectRoot, "docs", "agent-baseline.md");
   const ambientAgentsSentinel = `ambient-agents-${provider}-sentinel`;
   const ambientGeminiSentinel = `ambient-gemini-${provider}-sentinel`;
   const baselineSentinel = `baseline-${provider}-sentinel`;
   const agent = createContractAgent({
      agentPath,
      model: getContractModel(provider),
      provider
   });
   const agentFile = [
      "---",
      `name: ${agent.name}`,
      `provider: ${agent.provider}`,
      `description: ${agent.description}`,
      `permissions: ${agent.permissions}`,
      `model: ${agent.model}`,
      "contextFiles:",
      "  - docs/agent-baseline.md",
      "---",
      "",
      agent.body,
      ""
   ].join("\n");
   const baselineContent = [
      "# Agent Baseline",
      `BASELINE_CONTEXT_SENTINEL: ${baselineSentinel}`,
      "This file is attached explicitly through contextFiles.",
      ""
   ].join("\n");

   await mkdir(path.dirname(agentPath), { recursive: true });
   await mkdir(path.dirname(baselineFile), { recursive: true });
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
      [
         "# Router",
         `AGENTS_ROUTER_SENTINEL: ${ambientAgentsSentinel}`,
         ""
      ].join("\n"),
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
   await writeFile(baselineFile, baselineContent, "utf8");
   await writeFile(agentPath, agentFile, "utf8");

   return {
      agent,
      ambientAgentsSentinel,
      ambientGeminiSentinel,
      baselineContext: {
         content: baselineContent,
         path: "docs/agent-baseline.md"
      },
      baselineSentinel,
      cwd: projectRoot,
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
   agent: ScopedAgentDefinition;
   prepared: PreparedInvocation;
   runId: string;
   timeoutMs: number;
}): RunLaunchSnapshot {
   return {
      agentDigest: "provider-contract-agent",
      agentName: input.agent.name,
      agentPath: input.agent.path,
      agentScope: input.agent.scope,
      args: input.prepared.args,
      command: input.prepared.command,
      contextFiles: input.agent.contextFiles ?? [],
      cwd: input.prepared.cwd,
      envKeys: Object.keys(input.prepared.env).sort((left, right) =>
         left.localeCompare(right)
      ),
      killGraceMs: 1000,
      launchMode: "foreground",
      mode: input.agent.permissions,
      model: input.agent.model,
      permissions: input.agent.permissions,
      promptDigest: `provider-contract-prompt-${input.runId}`,
      promptTransport: input.prepared.promptTransport,
      provider: input.agent.provider,
      skills: [],
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
   baseline: string;
} {
   const trimmed = rawText.trim();
   const withoutCodeFence = trimmed.replace(
      /^```(?:json)?\s*|\s*```$/g,
      ""
   );
   const match = withoutCodeFence.match(/\{[\s\S]*\}/);

   if (!match) {
      throw new Error(`Provider output was not JSON:\n${rawText}`);
   }

   const parsed = JSON.parse(match[0]) as {
      ambientAgents?: unknown;
      ambientGemini?: unknown;
      baseline?: unknown;
   };

   if (
      typeof parsed.ambientAgents !== "string" ||
      typeof parsed.ambientGemini !== "string" ||
      typeof parsed.baseline !== "string"
   ) {
      throw new Error(`Provider JSON was missing expected keys:\n${rawText}`);
   }

   return {
      ambientAgents: parsed.ambientAgents,
      ambientGemini: parsed.ambientGemini,
      baseline: parsed.baseline
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
   const renderedPrompt = buildPrompt(fixture.agent, {
      artifactsDir: path.join(fixture.runDir, "artifacts"),
      contextFiles: [fixture.baselineContext],
      cwd: fixture.cwd,
      mode: fixture.agent.permissions,
      runFile: fixture.runFile,
      runId: fixture.runId,
      task: "Report visible sentinels from the authored prompt contract."
   });

   await writeFile(fixture.promptFile, renderedPrompt, "utf8");

   const prepared = await input.adapter.prepare(fixture.agent, {
      artifactsDir: path.join(fixture.runDir, "artifacts"),
      cwd: fixture.cwd,
      mode: fixture.agent.permissions,
      promptFile: fixture.promptFile,
      renderedPrompt,
      runFile: fixture.runFile,
      runId: fixture.runId,
      task: "Report visible sentinels from the authored prompt contract."
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
      agent: fixture.agent,
      cwd: fixture.cwd,
      endedAt: new Date().toISOString(),
      exitCode: completed.exitCode,
      launch: buildLaunchSnapshot({
         agent: fixture.agent,
         prepared,
         runId: fixture.runId,
         timeoutMs: providerContractTimeoutMs
      }),
      launchMode: "foreground",
      mode: fixture.agent.permissions,
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
      "NONE",
      `${input.provider} leaked ambient AGENTS.md context.`
   );
   assert.equal(
      parsed.ambientGemini,
      "NONE",
      `${input.provider} leaked ambient GEMINI.md context.`
   );
   assert.equal(
      parsed.baseline,
      fixture.baselineSentinel,
      `${input.provider} did not preserve explicit baseline context.`
   );

   const persistedPrompt = await readFile(fixture.promptFile, "utf8");

   assert.match(persistedPrompt, /## Project Context/);
   assert.match(persistedPrompt, /docs\/agent-baseline\.md/);
   assert.match(
      persistedPrompt,
      new RegExp(`BASELINE_CONTEXT_SENTINEL: ${fixture.baselineSentinel}`)
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
   "codex live contract keeps ambient project docs out and preserves explicit baseline context",
   { timeout: providerContractTimeoutMs + 15_000 },
   async (t) => {
      await runProviderContract(t, {
         adapter: createCodexAdapter(),
         provider: "codex"
      });
   }
);

test(
   "gemini live contract keeps ambient project docs out and preserves explicit baseline context",
   { timeout: providerContractTimeoutMs + 15_000 },
   async (t) => {
      await runProviderContract(t, {
         adapter: createGeminiAdapter(),
         provider: "gemini"
      });
   }
);
