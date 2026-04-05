import { mkdtemp } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import { buildPrompt } from "../src/lib/providers/shared.js";
import { toRunResult } from "../src/lib/runs.js";
import type {
   PersistedRunRecord,
   RunLaunchSnapshot,
   ScopedProfileDefinition
} from "../src/lib/types.js";

const codexProfile: ScopedProfileDefinition = {
   body: "Task: {{task}}\n\nReview the current change carefully.",
   description: "Reviews code for risks and quality",
   id: "code-reviewer",
   model: "gpt-5.4-mini",
   mode: "safe",
   name: "code-reviewer",
   path: "/repo/.aiman/agents/code-reviewer.md",
   provider: "codex",
   reasoningEffort: "medium",
   scope: "project"
};

const geminiProfile: ScopedProfileDefinition = {
   body: "Task: {{task}}\n\nBuild the requested change directly.",
   description: "Hands-on build profile",
   id: "builder",
   model: "gemini-2.5-flash-lite",
   mode: "yolo",
   name: "builder",
   path: "/repo/.aiman/agents/builder.md",
   provider: "gemini",
   reasoningEffort: "none",
   scope: "project"
};

const geminiAutoModelProfile: ScopedProfileDefinition = {
   body: geminiProfile.body,
   description: geminiProfile.description,
   id: "builder-auto",
   model: "auto",
   mode: geminiProfile.mode,
   name: "builder-auto",
   path: "/repo/.aiman/agents/builder-auto.md",
   provider: "gemini",
   reasoningEffort: "none",
   scope: "project"
};

test("codex adapter prepares a safe invocation with native context files", async () => {
   const adapter = createCodexAdapter();
   const artifactsDir = "/repo/.aiman/runs/run-1/artifacts";
   const prepared = await adapter.prepare(codexProfile, {
      artifactsDir,
      contextFileNames: ["AGENTS.md", "CONTEXT.md"],
      cwd: "/repo",
      mode: "safe",
      promptFile: "/repo/.aiman/runs/run-1/prompt.md",
      runFile: "/repo/.aiman/runs/run-1/run.md",
      runId: "run-1",
      task: "Review the diff"
   });

   assert.equal(prepared.command, "codex");
   assert.deepEqual(prepared.args.slice(0, 6), [
      "exec",
      "--sandbox",
      "read-only",
      "--cd",
      "/repo",
      "--output-last-message"
   ]);
   assert.match(prepared.args.join(" "), /--json/);
   assert.match(
      prepared.args.join(" "),
      new RegExp(
         `--add-dir ${artifactsDir.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`
      )
   );
   assert.match(prepared.args.join(" "), /approval_policy="never"/);
   assert.match(
      prepared.args.join(" "),
      /project_doc_fallback_filenames=\["CONTEXT\.md"\]/
   );
   assert.match(prepared.args.join(" "), /developer_instructions=""/);
   assert.match(prepared.args.join(" "), /instructions=""/);
   assert.match(prepared.args.join(" "), /agents=\{\}/);
   assert.match(prepared.args.join(" "), /model_reasoning_effort=medium/);
   assert.equal(
      prepared.renderedPrompt,
      "Task: Review the diff\n\nReview the current change carefully."
   );
   assert.equal(prepared.promptTransport, "stdin");
});

test("gemini adapter rejects non-none reasoning effort", () => {
   const adapter = createGeminiAdapter();
   const issues = adapter.validateAgent({
      ...geminiProfile,
      reasoningEffort: "medium"
   });

   assert.deepEqual(issues, [
      {
         code: "unsupported-reasoning-effort",
         message: 'Provider "gemini" requires reasoningEffort "none".'
      }
   ]);
});

test("gemini adapter prepares a yolo invocation with auto_edit", async () => {
   const adapter = createGeminiAdapter();
   const prepared = await adapter.prepare(geminiProfile, {
      artifactsDir: "/repo/.aiman/runs/run-2/artifacts",
      contextFileNames: ["AGENTS.md", "CONTEXT.md"],
      cwd: "/repo",
      mode: "yolo",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runFile: "/repo/.aiman/runs/run-2/run.md",
      runId: "run-2",
      task: "Implement the fix"
   });

   assert.equal(prepared.command, "gemini");
   assert.deepEqual(prepared.args.slice(0, 6), [
      "--prompt",
      "",
      "--output-format",
      "json",
      "--approval-mode",
      "auto_edit"
   ]);
   assert.equal(
      prepared.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,
      path.join("/repo/.aiman/runs/run-2", ".gemini-system-settings.json")
   );
   assert.deepEqual(prepared.supportFiles, [
      {
         content:
            '{\n  "context": {\n    "fileName": [\n      "AGENTS.md",\n      "CONTEXT.md"\n    ]\n  }\n}',
         path: path.join(
            "/repo/.aiman/runs/run-2",
            ".gemini-system-settings.json"
         )
      }
   ]);
   assert.equal(
      prepared.renderedPrompt,
      "Task: Implement the fix\n\nBuild the requested change directly."
   );
});

test("gemini adapter omits --model when the agent uses automatic selection", async () => {
   const adapter = createGeminiAdapter();
   const prepared = await adapter.prepare(geminiAutoModelProfile, {
      artifactsDir: "/repo/.aiman/runs/run-2/artifacts",
      cwd: "/repo",
      mode: "safe",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runFile: "/repo/.aiman/runs/run-2/run.md",
      runId: "run-2",
      task: "Check the docs"
   });

   assert.doesNotMatch(prepared.args.join(" "), /--model/);
});

test("gemini adapter parses structured JSON output", async () => {
   const adapter = createGeminiAdapter();
   const record = await adapter.parseCompletedRun({
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 0,
      launch: {
         agentDigest: "digest",
         agentName: "builder",
         agentPath: "/repo/.aiman/agents/builder.md",
         agentScope: "project",
         args: ["--prompt", "", "--output-format", "json"],
         command: "gemini",
         cwd: "/repo",
         envKeys: ["PATH"],
         killGraceMs: 1000,
         launchMode: "foreground",
         mode: "yolo",
         model: "gemini-2.5-flash-lite",
         permissions: "yolo",
         promptDigest: "prompt-digest",
         promptTransport: "stdin",
         provider: "gemini",
         task: "Implement the fix",
         timeoutMs: 300000
      },
      launchMode: "foreground",
      mode: "yolo",
      profile: geminiProfile,
      projectRoot: "/repo",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runDir: "/repo/.aiman/runs/run-2",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: "",
      stdout: JSON.stringify({
         response: "Implemented the fix.\n",
         session_id: "session-1",
         stats: {}
      })
   });

   assert.equal(record.finalText, "Implemented the fix.");
   assert.equal(record.status, "success");
});

test("gemini adapter reports structured JSON errors", async () => {
   const adapter = createGeminiAdapter();
   const record = await adapter.parseCompletedRun({
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 1,
      launch: {
         agentDigest: "digest",
         agentName: "builder",
         agentPath: "/repo/.aiman/agents/builder.md",
         agentScope: "project",
         args: ["--prompt", "", "--output-format", "json"],
         command: "gemini",
         cwd: "/repo",
         envKeys: ["PATH"],
         killGraceMs: 1000,
         launchMode: "foreground",
         mode: "yolo",
         model: "gemini-2.5-flash-lite",
         permissions: "yolo",
         promptDigest: "prompt-digest",
         promptTransport: "stdin",
         provider: "gemini",
         task: "Implement the fix",
         timeoutMs: 300000
      },
      launchMode: "foreground",
      mode: "yolo",
      profile: geminiProfile,
      projectRoot: "/repo",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runDir: "/repo/.aiman/runs/run-2",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: "",
      stdout: JSON.stringify({
         error: {
            message: "Gemini auth failed.",
            type: "AuthenticationError"
         },
         session_id: "session-1"
      })
   });

   assert.equal(record.errorMessage, "Gemini auth failed.");
   assert.equal(record.status, "error");
});

test("buildPrompt renders the authored body without inlining project context", () => {
   const prompt = buildPrompt(codexProfile, {
      artifactsDir: "/repo/.aiman/runs/run-1/artifacts",
      cwd: "/repo",
      mode: "safe",
      runFile: "/repo/.aiman/runs/run-1/run.md",
      runId: "run-1",
      task: "Review the release flow"
   });

   assert.doesNotMatch(prompt, /## Project Context/);
   assert.equal(
      prompt,
      "Task: Review the release flow\n\nReview the current change carefully."
   );
});

test("toRunResult reflects profile-first run metadata", async () => {
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-provider-run-"));
   const launch: RunLaunchSnapshot = {
      agentDigest: "legacy-agent-digest",
      agentName: "code-reviewer",
      agentPath: "/repo/.aiman/agents/code-reviewer.md",
      agentScope: "project",
      args: ["exec", "--sandbox", "read-only", "-"],
      command: "codex",
      cwd: "/repo",
      envKeys: ["PATH"],
      killGraceMs: 1000,
      launchMode: "foreground",
      mode: "safe",
      model: "gpt-5.4-mini",
      permissions: "safe",
      profileDigest: "profile-digest",
      profileName: "code-reviewer",
      profilePath: "/repo/.aiman/agents/code-reviewer.md",
      profileScope: "project",
      promptDigest: "prompt-digest",
      promptTransport: "stdin",
      provider: "codex",
      task: "Review the diff",
      timeoutMs: 300000
   };
   const record: PersistedRunRecord = {
      cwd: "/repo",
      durationMs: 5000,
      endedAt: "2026-03-28T15:00:05.000Z",
      errorMessage: "None",
      exitCode: 0,
      finalText: "Final review summary",
      launch,
      launchMode: "foreground",
      mode: "safe",
      paths: {
         artifactsDir: path.join(runDir, "artifacts"),
         promptFile: path.join(runDir, "prompt.md"),
         runFile: path.join(runDir, "run.md"),
         runDir,
         stopRequestedFile: path.join(runDir, ".stop-requested")
      },
      profile: "code-reviewer",
      profilePath: "/repo/.aiman/agents/code-reviewer.md",
      profileScope: "project",
      projectRoot: "/repo",
      provider: "codex",
      runId: "run-5",
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      status: "success"
   };

   assert.deepEqual(toRunResult(record), {
      agent: "code-reviewer",
      agentPath: "/repo/.aiman/agents/code-reviewer.md",
      agentScope: "project",
      errorMessage: "None",
      finalText: "Final review summary",
      launchMode: "foreground",
      mode: "safe",
      profile: "code-reviewer",
      profilePath: "/repo/.aiman/agents/code-reviewer.md",
      profileScope: "project",
      projectRoot: "/repo",
      provider: "codex",
      rights: "safe read-only workspace access via --sandbox read-only",
      runId: "run-5",
      runPath: path.join(runDir, "run.md"),
      status: "success"
   });
});
