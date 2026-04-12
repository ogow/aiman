import { mkdtemp } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import {
   finalizeRunRecord,
   renderAgentPrompt
} from "../src/lib/providers/runtime.js";
import { buildRunPaths, toRunResult } from "../src/lib/run-records.js";
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
   name: "code-reviewer",
   path: "/repo/.../agents/code-reviewer.md",
   provider: "codex",
   reasoningEffort: "medium",
   resultMode: "schema",
   scope: "project"
};

const geminiProfile: ScopedProfileDefinition = {
   body: "Task: {{task}}\n\nBuild the requested change directly.",
   description: "Hands-on build profile",
   id: "builder",
   model: "gemini-2.5-flash-lite",
   name: "builder",
   path: "/repo/.../agents/builder.md",
   provider: "gemini",
   reasoningEffort: "none",
   resultMode: "schema",
   scope: "project"
};

const geminiAutoModelProfile: ScopedProfileDefinition = {
   body: geminiProfile.body,
   description: geminiProfile.description,
   id: "builder-auto",
   model: "auto",
   name: "builder-auto",
   path: "/repo/.../agents/builder-auto.md",
   provider: "gemini",
   reasoningEffort: "none",
   resultMode: "schema",
   scope: "project"
};

const codexTextProfile: ScopedProfileDefinition = {
   ...codexProfile,
   id: "code-reviewer-text",
   name: "code-reviewer-text",
   resultMode: "text"
};

function buildAgentEnvelope(summary: string): string {
   return JSON.stringify({
      outcome: "done",
      result: {
         summary
      },
      summary
   });
}

function buildLaunchSnapshot(input: {
   preparedPrompt: string;
   provider: "codex" | "gemini";
   resultMode?: "schema" | "text";
}): RunLaunchSnapshot {
   return {
      agentDigest: "digest",
      agentName: input.provider === "codex" ? "code-reviewer" : "builder",
      agentPath:
         input.provider === "codex"
            ? "/repo/.../agents/code-reviewer.md"
            : "/repo/.../agents/builder.md",
      agentScope: "project",
      args:
         input.provider === "codex"
            ? ["exec", "--json"]
            : ["--prompt", "", "--output-format", "json"],
      command: input.provider,
      cwd: "/repo",
      envKeys: ["PATH"],
      killGraceMs: 1000,
      launchMode: "foreground",
      model:
         input.provider === "codex" ? "gpt-5.4-mini" : "gemini-2.5-flash-lite",
      promptDigest: "prompt-digest",
      promptTransport: "stdin",
      provider: input.provider,
      reasoningEffort: input.provider === "codex" ? "medium" : "none",
      resultMode: input.resultMode ?? "schema",
      renderedPrompt: input.preparedPrompt,
      task: "Implement the fix",
      timeoutMs: 300000
   };
}

test("codex adapter prepares a write-enabled invocation with native context files", async () => {
   const adapter = createCodexAdapter();
   const artifactsDir = "/repo/.../runs/run-1/artifacts";
   const prepared = await adapter.prepare(codexProfile, {
      artifactsDir,
      contextFileNames: ["AGENTS.md", "CONTEXT.md"],
      cwd: "/repo",
      runFile: "/repo/.../runs/run-1/run.json",
      runId: "run-1",
      task: "Review the diff"
   });

   assert.equal(prepared.command, "codex");
   assert.deepEqual(prepared.args.slice(0, 6), [
      "exec",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/repo",
      "--output-last-message"
   ]);
   assert.match(prepared.args.join(" "), /--json/);
   assert.match(prepared.args.join(" "), /--skip-git-repo-check/);
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
   assert.match(prepared.renderedPrompt, /Task: Review the diff/);
   assert.match(prepared.renderedPrompt, /## Required Result Contract/);
   assert.equal(prepared.promptTransport, "stdin");
   assert.equal(prepared.env.PLAYWRIGHT_MCP_OUTPUT_DIR, artifactsDir);
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

test("gemini adapter prepares a yolo invocation with yolo approval mode", async () => {
   const adapter = createGeminiAdapter();
   const artifactsDir = "/repo/.../runs/run-2/artifacts";
   const prepared = await adapter.prepare(geminiProfile, {
      artifactsDir,
      contextFileNames: ["AGENTS.md", "CONTEXT.md"],
      cwd: "/repo",
      runFile: "/repo/.../runs/run-2/run.json",
      runId: "run-2",
      task: "Implement the fix"
   });

   assert.equal(prepared.command, "gemini");
   assert.deepEqual(prepared.args.slice(0, 8), [
      "--prompt",
      "",
      "--output-format",
      "stream-json",
      "--include-directories",
      artifactsDir,
      "--approval-mode",
      "yolo"
   ]);
   assert.equal(
      prepared.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,
      path.join("/repo/.../runs/run-2", ".gemini-system-settings.json")
   );
   assert.equal(prepared.env.PLAYWRIGHT_MCP_OUTPUT_DIR, artifactsDir);
   assert.match(prepared.renderedPrompt, /Build the requested change directly/);
   assert.match(prepared.renderedPrompt, /## Required Result Contract/);
});

test("gemini adapter omits --model when the agent uses automatic selection", async () => {
   const adapter = createGeminiAdapter();
   const prepared = await adapter.prepare(geminiAutoModelProfile, {
      artifactsDir: "/repo/.../runs/run-2/artifacts",
      cwd: "/repo",
      runFile: "/repo/.../runs/run-2/run.json",
      runId: "run-2",
      task: "Check the docs"
   });

   assert.doesNotMatch(prepared.args.join(" "), /--model/);
});

test("gemini adapter parses structured JSON output", async () => {
   const adapter = createGeminiAdapter();
   const launch = buildLaunchSnapshot({
      preparedPrompt: renderAgentPrompt(geminiProfile, {
         artifactsDir: "/repo/.../runs/run-2/artifacts",
         cwd: "/repo",
         runFile: "/repo/.../runs/run-2/run.json",
         runId: "run-2",
         task: "Implement the fix"
      }),
      provider: "gemini"
   });
   const completion = await adapter.parseCompletion({
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 0,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runDir: "/repo/.../runs/run-2",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: "",
      stdout: JSON.stringify({
         response: buildAgentEnvelope("Implemented the fix."),
         session_id: "session-1",
         stats: {}
      })
   });
   const record = finalizeRunRecord({
      artifacts: [],
      completion,
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 0,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: ""
   });

   assert.equal(record.summary, "Implemented the fix.");
   assert.equal(record.outcome, "done");
   assert.equal(record.status, "success");
});

test("gemini adapter extracts a schema JSON object from prose-heavy output", async () => {
   const adapter = createGeminiAdapter();
   const launch = buildLaunchSnapshot({
      preparedPrompt: renderAgentPrompt(geminiProfile, {
         artifactsDir: "/repo/.../runs/run-2/artifacts",
         cwd: "/repo",
         runFile: "/repo/.../runs/run-2/run.json",
         runId: "run-2",
         task: "Implement the fix"
      }),
      provider: "gemini"
   });
   const completion = await adapter.parseCompletion({
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 0,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runDir: "/repo/.../runs/run-2",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: "",
      stdout: [
         JSON.stringify({
            type: "message",
            role: "assistant",
            content: "The crawl completed. "
         }),
         JSON.stringify({
            type: "message",
            role: "assistant",
            content: buildAgentEnvelope("Implemented the fix."),
            delta: true
         })
      ].join("\n")
   });
   const record = finalizeRunRecord({
      artifacts: [],
      completion,
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 0,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: ""
   });

   assert.equal(record.summary, "Implemented the fix.");
   assert.equal(record.outcome, "done");
   assert.equal(record.status, "success");
});

test("gemini adapter reports structured JSON errors", async () => {
   const adapter = createGeminiAdapter();
   const launch = buildLaunchSnapshot({
      preparedPrompt: renderAgentPrompt(geminiProfile, {
         artifactsDir: "/repo/.../runs/run-2/artifacts",
         cwd: "/repo",
         runFile: "/repo/.../runs/run-2/run.json",
         runId: "run-2",
         task: "Implement the fix"
      }),
      provider: "gemini"
   });
   const completion = await adapter.parseCompletion({
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 1,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runDir: "/repo/.../runs/run-2",
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
   const record = finalizeRunRecord({
      artifacts: [],
      completion,
      cwd: "/repo",
      endedAt: "2026-04-05T13:10:05.000Z",
      exitCode: 1,
      launch,
      launchMode: "foreground",
      profile: geminiProfile,
      projectRoot: "/repo",
      runId: "run-2",
      signal: null,
      startedAt: "2026-04-05T13:10:00.000Z",
      stderr: ""
   });

   assert.equal(record.error?.message, "Gemini auth failed.");
   assert.equal(record.status, "error");
});

test("renderAgentPrompt appends the runtime JSON contract for schema agents", () => {
   const artifactsDir = "/repo/.../runs/run-1/artifacts";
   const prompt = renderAgentPrompt(codexProfile, {
      artifactsDir,
      cwd: "/repo",
      runFile: "/repo/.../runs/run-1/run.json",
      runId: "run-1",
      task: "Review the release flow"
   });

   assert.doesNotMatch(prompt, /## Project Context/);
   assert.match(prompt, /Task: Review the release flow/);
   assert.match(prompt, /## Required Result Contract/);
});

test("renderAgentPrompt leaves text-mode agents unconstrained by the schema contract", () => {
   const prompt = renderAgentPrompt(codexTextProfile, {
      artifactsDir: "/repo/.../runs/run-1/artifacts",
      cwd: "/repo",
      runFile: "/repo/.../runs/run-1/run.json",
      runId: "run-1",
      task: "Review the release flow"
   });

   assert.match(prompt, /Task: Review the release flow/);
   assert.doesNotMatch(prompt, /## Required Result Contract/);
});

test("toRunResult reflects the canonical result metadata", async () => {
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-provider-run-"));
   const launch: RunLaunchSnapshot = {
      ...buildLaunchSnapshot({
         preparedPrompt: "Prompt body",
         provider: "codex"
      }),
      agentName: "code-reviewer",
      agentPath: "/repo/.../agents/code-reviewer.md",
      profileDigest: "profile-digest",
      profileName: "code-reviewer",
      profilePath: "/repo/.../agents/code-reviewer.md",
      profileScope: "project",
      task: "Review the diff"
   };
   const record: PersistedRunRecord = {
      agent: "code-reviewer",
      agentPath: "/repo/.../agents/code-reviewer.md",
      agentScope: "project",
      artifacts: [],
      cwd: "/repo",
      durationMs: 5000,
      endedAt: "2026-03-28T15:00:05.000Z",
      exitCode: 0,
      launch,
      launchMode: "foreground",
      logs: {
         stderr: "stderr.log",
         stdout: "stdout.log"
      },
      model: "gpt-5.4-mini",
      outcome: "done",
      projectRoot: "/repo",
      provider: "codex",
      resultMode: "schema",
      structuredResult: {
         findings: []
      },
      runId: "run-5",
      schemaVersion: 1,
      signal: null,
      startedAt: "2026-03-28T15:00:00.000Z",
      status: "success",
      summary: "Final review summary"
   };
   const paths = buildRunPaths(runDir);

   assert.deepEqual(toRunResult(record, paths), {
      agent: "code-reviewer",
      agentPath: "/repo/.../agents/code-reviewer.md",
      agentScope: "project",
      artifacts: [],
      launchMode: "foreground",
      outcome: "done",
      projectRoot: "/repo",
      provider: "codex",
      resultMode: "schema",
      structuredResult: {
         findings: []
      },
      rights:
         "write-enabled project workspace via --sandbox workspace-write; Codex git repo check skipped; artifacts dir writable via --add-dir",
      runId: "run-5",
      runFile: path.join(runDir, "run.json"),
      status: "success",
      summary: "Final review summary"
   });
});
