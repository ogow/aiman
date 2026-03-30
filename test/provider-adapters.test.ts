import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import { toRunResult } from "../src/lib/runs.js";
import type { AgentDefinition, PersistedRunRecord } from "../src/lib/types.js";

const codexAgent: AgentDefinition = {
   body: "Review the current change carefully.",
   description: "Reviews code for risks and quality",
   model: "gpt-5.4",
   name: "code-reviewer",
   provider: "codex",
   reasoningEffort: "medium"
};

const geminiAgent: AgentDefinition = {
   body: "Research the problem space carefully.",
   description: "Research specialist",
   name: "researcher",
   provider: "gemini"
};

test("codex adapter prepares a headless read-only invocation", () => {
   const adapter = createCodexAdapter();
   const prepared = adapter.prepare(codexAgent, {
      artifactsDir: "/repo/.aiman/runs/run-1/artifacts",
      cwd: "/repo",
      mode: "read-only",
      promptFile: "/repo/.aiman/runs/run-1/prompt.md",
      runFile: "/repo/.aiman/runs/run-1/run.md",
      runId: "run-1",
      task: "Review the diff"
   });

   assert.equal(prepared.command, "codex");
   assert.deepEqual(prepared.args.slice(0, 7), [
      "exec",
      "--sandbox",
      "read-only",
      "-a",
      "never",
      "--cd",
      "/repo"
   ]);
   assert.equal(
      prepared.env.AIMAN_ARTIFACTS_DIR,
      "/repo/.aiman/runs/run-1/artifacts"
   );
   assert.equal(prepared.env.AIMAN_RUN_PATH, "/repo/.aiman/runs/run-1/run.md");
   assert.equal(prepared.env.AIMAN_RUN_DIR, "/repo/.aiman/runs/run-1");
   assert.equal(prepared.env.AIMAN_RUN_ID, "run-1");
   assert.match(prepared.renderedPrompt, /Task: Review the diff/);
   assert.match(prepared.renderedPrompt, /Execution mode: read-only/);
   assert.match(
      prepared.renderedPrompt,
      /Optional structured run path: \/repo\/\.aiman\/runs\/run-1\/run\.md/
   );
   assert.match(
      prepared.renderedPrompt,
      /Use the optional run\/artifact paths only when your authored instructions need persisted handoff files/
   );
});

test("gemini adapter prepares a headless workspace-write invocation", () => {
   const adapter = createGeminiAdapter();
   const prepared = adapter.prepare(geminiAgent, {
      artifactsDir: "/repo/.aiman/runs/run-2/artifacts",
      cwd: "/repo",
      mode: "workspace-write",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runFile: "/repo/.aiman/runs/run-2/run.md",
      runId: "run-2",
      task: "Research the API"
   });

   assert.equal(prepared.command, "gemini");
   assert.deepEqual(prepared.args.slice(0, 4), [
      "--prompt",
      prepared.renderedPrompt,
      "--approval-mode",
      "auto_edit"
   ]);
   assert.equal(
      prepared.env.AIMAN_ARTIFACTS_DIR,
      "/repo/.aiman/runs/run-2/artifacts"
   );
   assert.equal(prepared.env.AIMAN_RUN_PATH, "/repo/.aiman/runs/run-2/run.md");
   assert.equal(prepared.env.AIMAN_RUN_DIR, "/repo/.aiman/runs/run-2");
   assert.equal(prepared.env.AIMAN_RUN_ID, "run-2");
   assert.match(prepared.renderedPrompt, /Task: Research the API/);
   assert.match(prepared.renderedPrompt, /Execution mode: workspace-write/);
});

test("codex adapter prefers the persisted last message over noisy stdout", async () => {
   const adapter = createCodexAdapter();
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-codex-"));
   const fallbackFile = path.join(runDir, ".codex-last-message.txt");

   await writeFile(fallbackFile, "Primary answer\n", "utf8");

   const record = await adapter.parseCompletedRun({
      agent: codexAgent,
      cwd: "/repo",
      endedAt: "2026-03-28T15:00:05.000Z",
      exitCode: 0,
      mode: "read-only",
      promptFile: path.join(runDir, "prompt.md"),
      runDir,
      runId: "run-3",
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      stderr: "",
      stderrLog: path.join(runDir, "stderr.log"),
      stdout: "Thinking...\nPrimary answer\n",
      stdoutLog: path.join(runDir, "stdout.log")
   });

   assert.equal(record.status, "success");
   assert.equal(record.finalText, "Primary answer");
   assert.equal(record.usage, undefined);
});

test("codex adapter falls back to stdout when no last message file exists", async () => {
   const adapter = createCodexAdapter();
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-codex-"));

   const record = await adapter.parseCompletedRun({
      agent: codexAgent,
      cwd: "/repo",
      endedAt: "2026-03-28T15:00:05.000Z",
      exitCode: 0,
      mode: "read-only",
      promptFile: path.join(runDir, "prompt.md"),
      runDir,
      runId: "run-3b",
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      stderr: "",
      stderrLog: path.join(runDir, "stderr.log"),
      stdout: "Primary answer\n",
      stdoutLog: path.join(runDir, "stdout.log")
   });

   assert.equal(record.status, "success");
   assert.equal(record.finalText, "Primary answer");
   assert.equal(record.usage, undefined);
});

test("gemini adapter parses plain text output", async () => {
   const adapter = createGeminiAdapter();
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-gemini-"));

   const record = await adapter.parseCompletedRun({
      agent: geminiAgent,
      cwd: "/repo",
      endedAt: "2026-03-28T15:00:05.000Z",
      exitCode: 0,
      mode: "read-only",
      promptFile: path.join(runDir, "prompt.md"),
      runDir,
      runId: "run-4",
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      stderr: "",
      stderrLog: path.join(runDir, "stderr.log"),
      stdout: "Gemini answer\n",
      stdoutLog: path.join(runDir, "stdout.log")
   });

   assert.equal(record.status, "success");
   assert.equal(record.finalText, "Gemini answer");
   assert.equal(record.usage, undefined);
});

test("toRunResult keeps the external payload slim", () => {
   const record: PersistedRunRecord = {
      agent: "code-reviewer",
      cwd: "/repo",
      durationMs: 5000,
      endedAt: "2026-03-28T15:00:05.000Z",
      errorMessage: "None",
      exitCode: 0,
      finalText: "Final review summary",
      mode: "read-only",
      paths: {
         artifactsDir: "/repo/.aiman/runs/run-5/artifacts",
         promptFile: "/repo/.aiman/runs/run-5/prompt.md",
         runFile: "/repo/.aiman/runs/run-5/run.md",
         runDir: "/repo/.aiman/runs/run-5",
         stderrLog: "/repo/.aiman/runs/run-5/stderr.log",
         stdoutLog: "/repo/.aiman/runs/run-5/stdout.log"
      },
      provider: "codex",
      runId: "run-5",
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      status: "success"
   };

   assert.deepEqual(toRunResult(record), {
      agent: "code-reviewer",
      errorMessage: "None",
      finalText: "Final review summary",
      mode: "read-only",
      provider: "codex",
      runId: "run-5",
      runPath: "/repo/.aiman/runs/run-5/run.md",
      status: "success"
   });
});
