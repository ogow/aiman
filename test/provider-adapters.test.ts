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
   ResolvedSkill,
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
   path: "/repo/.aiman/profiles/code-reviewer.md",
   provider: "codex",
   scope: "project"
};

const geminiProfile: ScopedProfileDefinition = {
   body: "Task: {{task}}\n\nBuild the requested change directly.",
   description: "Hands-on build profile",
   id: "builder",
   model: "gemini-2.5-flash-lite",
   mode: "yolo",
   name: "builder",
   path: "/repo/.aiman/profiles/builder.md",
   provider: "gemini",
   scope: "project"
};

test("codex adapter prepares a safe invocation with provider isolation", async () => {
   const adapter = createCodexAdapter();
   const prepared = await adapter.prepare(codexProfile, {
      artifactsDir: "/repo/.aiman/runs/run-1/artifacts",
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
   assert.match(prepared.args.join(" "), /project_doc_max_bytes=0/);
   assert.match(prepared.args.join(" "), /project_doc_fallback_filenames=\[\]/);
   assert.match(prepared.args.join(" "), /developer_instructions=""/);
   assert.match(prepared.args.join(" "), /instructions=""/);
   assert.match(prepared.args.join(" "), /agents=\{\}/);
   assert.equal(
      prepared.renderedPrompt,
      "Task: Review the diff\n\nReview the current change carefully."
   );
   assert.equal(prepared.promptTransport, "stdin");
});

test("gemini adapter prepares a yolo invocation with auto_edit", async () => {
   const adapter = createGeminiAdapter();
   const prepared = await adapter.prepare(geminiProfile, {
      artifactsDir: "/repo/.aiman/runs/run-2/artifacts",
      cwd: "/repo",
      mode: "yolo",
      promptFile: "/repo/.aiman/runs/run-2/prompt.md",
      runFile: "/repo/.aiman/runs/run-2/run.md",
      runId: "run-2",
      task: "Implement the fix"
   });

   assert.equal(prepared.command, "gemini");
   assert.deepEqual(prepared.args.slice(0, 4), [
      "--prompt",
      "",
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
            '{\n  "context": {\n    "fileName": "__AIMAN_UNUSED_CONTEXT__.md"\n  }\n}',
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

test("buildPrompt appends explicit AGENTS runtime context and active skills", () => {
   const activeSkill: ResolvedSkill = {
      body: "- Search the repo before answering.\n",
      description: "Search guidance",
      digest: "skill-digest",
      keywords: ["search"],
      name: "repo-search",
      path: "/repo/.aiman/skills/repo-search/SKILL.md",
      scope: "project"
   };

   const prompt = buildPrompt(codexProfile, {
      artifactsDir: "/repo/.aiman/runs/run-1/artifacts",
      cwd: "/repo",
      mode: "safe",
      projectContext: {
         content: "- Build with `npm test`\n",
         path: "AGENTS.md#Aiman Runtime Context",
         title: "## Aiman Runtime Context"
      },
      runFile: "/repo/.aiman/runs/run-1/run.md",
      runId: "run-1",
      skills: [activeSkill],
      task: "Review the release flow"
   });

   assert.match(prompt, /## Project Context/);
   assert.match(prompt, /AGENTS\.md#Aiman Runtime Context/);
   assert.match(prompt, /Build with `npm test`/);
   assert.match(prompt, /## Active Skills/);
   assert.match(prompt, /repo-search/);
});

test("toRunResult reflects profile-first run metadata", async () => {
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-provider-run-"));
   const launch: RunLaunchSnapshot = {
      agentDigest: "legacy-agent-digest",
      agentName: "code-reviewer",
      agentPath: "/repo/.aiman/profiles/code-reviewer.md",
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
      profilePath: "/repo/.aiman/profiles/code-reviewer.md",
      profileScope: "project",
      promptDigest: "prompt-digest",
      promptTransport: "stdin",
      provider: "codex",
      skills: ["repo-search"],
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
      profilePath: "/repo/.aiman/profiles/code-reviewer.md",
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
      agentPath: "/repo/.aiman/profiles/code-reviewer.md",
      agentScope: "project",
      errorMessage: "None",
      finalText: "Final review summary",
      launchMode: "foreground",
      mode: "safe",
      profile: "code-reviewer",
      profilePath: "/repo/.aiman/profiles/code-reviewer.md",
      profileScope: "project",
      projectRoot: "/repo",
      provider: "codex",
      rights: "safe read-only workspace access via --sandbox read-only",
      runId: "run-5",
      runPath: path.join(runDir, "run.md"),
      status: "success"
   });
});
