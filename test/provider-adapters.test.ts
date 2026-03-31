import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createCodexAdapter } from "../src/lib/providers/codex.js";
import { createGeminiAdapter } from "../src/lib/providers/gemini.js";
import { buildPrompt } from "../src/lib/providers/shared.js";
import { toRunResult } from "../src/lib/runs.js";
import type {
   PersistedRunRecord,
   RunLaunchSnapshot,
   ScopedAgentDefinition
} from "../src/lib/types.js";

const codexAgent: ScopedAgentDefinition = {
   body: "Task: {{task}}\n\nReview the current change carefully.",
   description: "Reviews code for risks and quality",
   id: "code-reviewer",
   model: "gpt-5.4-mini",
   name: "code-reviewer",
   path: "/repo/.aiman/agents/code-reviewer.md",
   permissions: "read-only",
   provider: "codex",
   reasoningEffort: "low",
   scope: "project"
};

const geminiAgent: ScopedAgentDefinition = {
   body: "Task: {{task}}\n\nResearch the problem space carefully.",
   description: "Research specialist",
   id: "researcher",
   model: "gemini-2.5-flash-lite",
   name: "researcher",
   path: "/repo/.aiman/agents/researcher.md",
   permissions: "read-only",
   provider: "gemini",
   scope: "project"
};

async function withMockExecutable(
   command: "codex" | "gemini",
   script: string,
   callback: () => Promise<void>
): Promise<void> {
   const binDir = await mkdtemp(path.join(os.tmpdir(), "aiman-provider-bin-"));
   const executablePath = path.join(binDir, command);
   const originalPath = process.env.PATH;

   await mkdir(binDir, { recursive: true });
   await writeFile(executablePath, script, {
      encoding: "utf8",
      mode: 0o755
   });
   process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

   try {
      await callback();
   } finally {
      if (originalPath === undefined) {
         delete process.env.PATH;
      } else {
         process.env.PATH = originalPath;
      }
   }
}

const foregroundLaunch: RunLaunchSnapshot = {
   agentDigest: "agent-digest",
   agentName: "code-reviewer",
   agentPath: "/repo/.aiman/agents/code-reviewer.md",
   agentScope: "project",
   args: ["exec", "--sandbox", "read-only", "-"],
   command: "codex",
   cwd: "/repo",
   envKeys: ["AIMAN_RUN_ID", "OPENAI_API_KEY", "PATH"],
   killGraceMs: 1000,
   launchMode: "foreground",
   mode: "read-only",
   model: "gpt-5.4-mini",
   permissions: "read-only",
   promptDigest: "prompt-digest",
   promptTransport: "stdin",
   provider: "codex",
   reasoningEffort: "low",
   skills: [],
   timeoutMs: 300000
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
   assert.match(
      prepared.args.join(" "),
      /--config model_reasoning_effort="low"/
   );
   assert.equal(
      prepared.env.AIMAN_ARTIFACTS_DIR,
      "/repo/.aiman/runs/run-1/artifacts"
   );
   assert.equal(prepared.env.AIMAN_RUN_PATH, "/repo/.aiman/runs/run-1/run.md");
   assert.equal(prepared.env.AIMAN_RUN_DIR, "/repo/.aiman/runs/run-1");
   assert.equal(prepared.env.AIMAN_RUN_ID, "run-1");
   assert.equal(
      prepared.renderedPrompt,
      "Task: Review the diff\n\nReview the current change carefully."
   );
   assert.equal(prepared.promptTransport, "stdin");
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
   assert.equal(
      prepared.renderedPrompt,
      "Task: Research the API\n\nResearch the problem space carefully."
   );
   assert.equal(prepared.promptTransport, "arg");
});

test("gemini adapter rejects reasoningEffort", () => {
   const adapter = createGeminiAdapter();

   assert.deepEqual(
      adapter.validateAgent({ ...geminiAgent, reasoningEffort: "high" }),
      [
         {
            code: "unsupported-reasoning-effort",
            message: 'Provider "gemini" does not support reasoningEffort.'
         }
      ]
   );
});

test("codex adapter detects missing required MCPs", async () => {
   await withMockExecutable(
      "codex",
      `#!/bin/sh
if [ "$1" = "mcp" ] && [ "$2" = "list" ]
then
  cat <<'EOF'
[
  {
    "name": "chrome-devtools",
    "enabled": true,
    "disabled_reason": null,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    },
    "auth_status": "unsupported"
  }
]
EOF
  exit 0
fi
exit 0
`,
      async () => {
         const adapter = createCodexAdapter();

         assert.deepEqual(
            await adapter.detect({
               ...codexAgent,
               requiredMcps: ["github"]
            }),
            [
               {
                  code: "missing-required-mcp",
                  message:
                     'Agent "code-reviewer" requires MCP "github", but provider "codex" did not list it in "codex mcp list --json".'
               }
            ]
         );
      }
   );
});

test("gemini adapter detects disconnected required MCPs", async () => {
   await withMockExecutable(
      "gemini",
      `#!/bin/sh
if [ "$1" = "mcp" ] && [ "$2" = "list" ]
then
  cat <<'EOF'
Configured MCP servers:

✓ github: https://api.githubcopilot.com/mcp/ (http) - Disconnected
EOF
  exit 0
fi
exit 0
`,
      async () => {
         const adapter = createGeminiAdapter();

         assert.deepEqual(
            await adapter.detect({
               ...geminiAgent,
               requiredMcps: ["github"]
            }),
            [
               {
                  code: "disconnected-required-mcp",
                  message:
                     'Agent "researcher" requires MCP "github", but provider "gemini" reported it as disconnected.'
               }
            ]
         );
      }
   );
});

test("buildPrompt preserves literal task text", () => {
   assert.equal(
      buildPrompt(codexAgent, {
         artifactsDir: "/repo/.aiman/runs/run-1/artifacts",
         cwd: "/repo",
         mode: "read-only",
         runFile: "/repo/.aiman/runs/run-1/run.md",
         runId: "run-1",
         task: "Explain {{cwd}} and cost is $&"
      }),
      "Task: Explain {{cwd}} and cost is $&\n\nReview the current change carefully."
   );
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
      launch: foregroundLaunch,
      launchMode: "foreground",
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
   assert.equal(record.launch.agentDigest, "agent-digest");
   assert.equal(record.launchMode, "foreground");
   assert.equal(record.usage, undefined);
});

test("codex adapter fails when the expected last message file is missing", async () => {
   const adapter = createCodexAdapter();
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-codex-"));

   const record = await adapter.parseCompletedRun({
      agent: codexAgent,
      cwd: "/repo",
      endedAt: "2026-03-28T15:00:05.000Z",
      exitCode: 0,
      launch: foregroundLaunch,
      launchMode: "foreground",
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

   assert.equal(record.status, "error");
   assert.equal(record.finalText, "");
   assert.equal(record.launchMode, "foreground");
   assert.equal(
      record.errorMessage,
      "Codex did not write the expected last-message file."
   );
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
      launch: {
         ...foregroundLaunch,
         agentName: "researcher",
         agentPath: "/repo/.aiman/agents/researcher.md",
         args: ["--prompt", "@prompt.md", "--approval-mode", "plan"],
         command: "gemini",
         promptTransport: "arg",
         provider: "gemini"
      },
      launchMode: "foreground",
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
   assert.equal(record.launchMode, "foreground");
   assert.equal(record.usage, undefined);
});

test("toRunResult keeps the external payload slim", () => {
   const record: PersistedRunRecord = {
      agent: "code-reviewer",
      agentPath: "/repo/.aiman/agents/code-reviewer.md",
      agentScope: "project",
      cwd: "/repo",
      durationMs: 5000,
      endedAt: "2026-03-28T15:00:05.000Z",
      errorMessage: "None",
      exitCode: 0,
      finalText: "Final review summary",
      launch: foregroundLaunch,
      launchMode: "foreground",
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
      agentPath: "/repo/.aiman/agents/code-reviewer.md",
      agentScope: "project",
      errorMessage: "None",
      finalText: "Final review summary",
      launchMode: "foreground",
      mode: "read-only",
      provider: "codex",
      rights: "read-only workspace access via --sandbox read-only",
      runId: "run-5",
      runPath: "/repo/.aiman/runs/run-5/run.md",
      status: "success"
   });
});
