import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliEntrypoint = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function runCli(
   args: string[],
   options: {
      cwd: string;
      env?: NodeJS.ProcessEnv;
      input?: string;
   }
) {
   return spawnSync(process.execPath, ["run", cliEntrypoint, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      env: {
         ...process.env,
         ...options.env
      },
      input: options.input
   });
}

async function createHomeFixture(): Promise<string> {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-"));
   await mkdir(path.join(homeRoot, ".aiman", "agents"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "runs"), { recursive: true });
   return homeRoot;
}

async function createProjectFixture(): Promise<string> {
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-project-"));
   await mkdir(path.join(projectRoot, ".aiman", "agents"), {
      recursive: true
   });
   return projectRoot;
}

async function createFakeCodexBinary(binDir: string): Promise<void> {
   const scriptPath = path.join(binDir, "codex.mjs");
   const launcherPath = path.join(
      binDir,
      process.platform === "win32" ? "codex.cmd" : "codex"
   );

   await mkdir(binDir, { recursive: true });
   await writeFile(
      scriptPath,
      `import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

let lastMessagePath = "";
let useJsonOutput = false;
for (let index = 0; index < process.argv.length; index += 1) {
   if (process.argv[index] === "--output-last-message") {
      lastMessagePath = process.argv[index + 1] ?? "";
   }
   if (process.argv[index] === "--json") {
      useJsonOutput = true;
   }
}

const chunks = [];
for await (const chunk of process.stdin) {
   chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

const prompt = Buffer.concat(chunks).toString("utf8");

if (lastMessagePath.length > 0) {
   await mkdir(path.dirname(lastMessagePath), { recursive: true });
   await writeFile(lastMessagePath, "Fake codex result\\n", "utf8");
}

const runDir = process.env.AIMAN_RUN_DIR;
if (typeof runDir === "string" && runDir.length > 0) {
   await writeFile(path.join(runDir, "prompt-copy.md"), prompt, "utf8");
}

if (useJsonOutput) {
   process.stdout.write(
      JSON.stringify({
         id: "evt-1",
         message: { role: "assistant", content: "Fake codex result" },
         type: "turn.completed"
      }) + "\\n"
   );
} else {
   process.stdout.write("provider stdout\\n");
}
`,
      "utf8"
   );
   await writeFile(
      launcherPath,
      process.platform === "win32"
         ? `@echo off\r
"${process.execPath}" "%~dp0\\codex.mjs" %*\r
`
         : `#!/usr/bin/env sh
"${process.execPath}" "$(dirname "$0")/codex.mjs" "$@"
`,
      {
         encoding: "utf8",
         mode: 0o755
      }
   );
}

async function createRunnableFixture(): Promise<{
   binDir: string;
   homeRoot: string;
   projectRoot: string;
}> {
   const homeRoot = await createHomeFixture();
   const projectRoot = await createProjectFixture();
   const binDir = path.join(projectRoot, "bin");

   await createFakeCodexBinary(binDir);
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
description: Reviews changes carefully
provider: codex
model: gpt-5.4-mini
reasoningEffort: medium
---

## Role
You are a focused reviewer.

## Task Input
{{task}}

## Instructions
- Review the request carefully.
- Report the result clearly.

## Constraints
- Use the repo's native context files.

## Expected Output
- Return a concise result.
`,
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      `# Router

## Human Notes
This section must not be attached.

## Aiman Runtime Context
- Build with \`npm test\`
- The project keeps agents under \`.aiman/agents\`
`,
      "utf8"
   );

   return { binDir, homeRoot, projectRoot };
}

function createCliEnv(input: {
   binDir?: string;
   homeRoot: string;
}): NodeJS.ProcessEnv {
   return {
      HOME: input.homeRoot,
      PATH:
         typeof input.binDir === "string"
            ? `${input.binDir}${path.delimiter}${process.env.PATH ?? ""}`
            : process.env.PATH,
      USERPROFILE: input.homeRoot
   };
}

test("no-arg aiman opens the app and requires a tty", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli([], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /interactive TTY/);
});

test("agent list includes built-in build and plan agents", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(["agent", "list", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      agents: Array<{ isBuiltIn?: boolean; name: string }>;
   };

   assert.ok(payload.agents.some((agent) => agent.name === "build"));
   assert.ok(payload.agents.some((agent) => agent.name === "plan"));
});

test("agent create writes a project-scope agent", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(
      [
         "agent",
         "create",
         "auditor",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4-mini",
         "--reasoning-effort",
         "medium",
         "--description",
         "Audits the project",
         "--instructions",
         "Follow the task carefully."
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.equal(result.status, 0);
   const createdPath = path.join(projectRoot, ".aiman", "agents", "auditor.md");
   const created = await readFile(createdPath, "utf8");
   assert.match(created, /name: auditor/);
   assert.match(created, /reasoningEffort: medium/);
});

test("agent create rejects unsupported provider reasoning effort", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const createdPath = path.join(projectRoot, ".aiman", "agents", "auditor.md");
   const result = runCli(
      [
         "agent",
         "create",
         "auditor",
         "--scope",
         "project",
         "--provider",
         "gemini",
         "--model",
         "gemini-2.5-flash-lite",
         "--reasoning-effort",
         "medium",
         "--description",
         "Audits the project",
         "--instructions",
         "Follow the task carefully."
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.notEqual(result.status, 0);
   assert.match(
      result.stderr,
      /invalid reasoningEffort "medium" for provider "gemini"/
   );
   await assert.rejects(readFile(createdPath, "utf8"), { code: "ENOENT" });
});

test("agent create rejects missing reasoning-effort for Codex", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(
      [
         "agent",
         "create",
         "codex-agent",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4-mini",
         "--description",
         "Test codex agent",
         "--instructions",
         "Do something."
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.notEqual(result.status, 0);
   assert.match(
      result.stderr,
      /Reasoning effort is required for provider "codex"/
   );
});

test('agent create allows Gemini with "auto" model selection', async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(
      [
         "agent",
         "create",
         "doc-checker",
         "--scope",
         "project",
         "--provider",
         "gemini",
         "--model",
         "auto",
         "--description",
         "Checks docs for drift",
         "--instructions",
         "Inspect the requested docs and report drift."
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.equal(result.status, 0);
   assert.match(result.stdout, /automatic \(Gemini default\)/);

   const createdPath = path.join(
      projectRoot,
      ".aiman",
      "agents",
      "doc-checker.md"
   );
   const created = await readFile(createdPath, "utf8");
   assert.match(created, /provider: gemini/);
   assert.match(created, /^model: auto$/m);
   assert.ok(
      !created.includes("reasoningEffort:"),
      "Should omit reasoningEffort for Gemini"
   );
});

test('agent create rejects "auto" model selection for Codex', async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const createdPath = path.join(projectRoot, ".aiman", "agents", "builder.md");
   const result = runCli(
      [
         "agent",
         "create",
         "builder",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "auto",
         "--reasoning-effort",
         "medium",
         "--description",
         "Builds changes",
         "--instructions",
         "Work on the requested change."
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.notEqual(result.status, 0);
   assert.match(
      result.stderr,
      /Only Gemini supports automatic model selection via "model: auto"/
   );
   await assert.rejects(readFile(createdPath, "utf8"), { code: "ENOENT" });
});

test("agent check allows Gemini to omit reasoningEffort", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "no-reasoning.md"),
      `---
name: no-reasoning
description: No reasoning agent
provider: gemini
model: auto
---

Body {{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "no-reasoning", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 0);
   const report = JSON.parse(result.stdout);
   assert.equal(report.agent.reasoningEffort, "none");
});

test("agent check rejects unsupported legacy frontmatter", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "legacy.md"),
      `---
name: legacy
description: Legacy agent
provider: codex
model: gpt-5.4-mini
mode: safe
reasoningEffort: none
contextFiles:
  - docs/old.md
---

Legacy body {{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "legacy"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /unsupported field "contextFiles"/);
});

test("run prompt keeps native context out of prompt.md without implicit context files", async () => {
   const fixture = await createRunnableFixture();
   const runResult = runCli(
      ["run", "reviewer", "--task", "Review the docs", "--json"],
      {
         cwd: fixture.projectRoot,
         env: createCliEnv({
            binDir: fixture.binDir,
            homeRoot: fixture.homeRoot
         })
      }
   );

   assert.equal(runResult.status, 0);
   const payload = JSON.parse(runResult.stdout) as {
      runId: string;
      status: string;
   };
   assert.equal(payload.status, "success");

   const promptResult = runCli(
      ["runs", "inspect", payload.runId, "--stream", "prompt"],
      {
         cwd: fixture.projectRoot,
         env: createCliEnv({
            binDir: fixture.binDir,
            homeRoot: fixture.homeRoot
         })
      }
   );

   assert.equal(promptResult.status, 0);
   assert.doesNotMatch(promptResult.stdout, /## Project Context/);
   assert.doesNotMatch(promptResult.stdout, /Human Notes/);
   assert.doesNotMatch(promptResult.stdout, /## Active Skills/);

   const inspectResult = runCli(["runs", "inspect", payload.runId, "--json"], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });

   assert.equal(inspectResult.status, 0);
   const inspectPayload = JSON.parse(inspectResult.stdout) as {
      launch: {
         contextFiles?: string[];
         task?: string;
      };
   };
   assert.equal(inspectPayload.launch.contextFiles, undefined);
   assert.equal(inspectPayload.launch.task, "Review the docs");
});

test("runs list show and logs use the new command surface", async () => {
   const fixture = await createRunnableFixture();
   const runResult = runCli(
      ["run", "reviewer", "--task", "Review the docs", "--json"],
      {
         cwd: fixture.projectRoot,
         env: createCliEnv({
            binDir: fixture.binDir,
            homeRoot: fixture.homeRoot
         })
      }
   );
   const payload = JSON.parse(runResult.stdout) as {
      runId: string;
   };

   const listResult = runCli(["runs", "list", "--all", "--json"], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });
   assert.equal(listResult.status, 0);
   const listPayload = JSON.parse(listResult.stdout) as {
      runs: Array<{ runId: string }>;
   };
   assert.ok(listPayload.runs.some((run) => run.runId === payload.runId));

   const showResult = runCli(["runs", "show", payload.runId], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });
   assert.equal(showResult.status, 0);
   assert.match(showResult.stdout, /Agent\s+reviewer/);
   assert.match(showResult.stdout, /Next steps/);

   const logsResult = runCli(["runs", "logs", payload.runId], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });
   assert.equal(logsResult.status, 0);
   assert.match(logsResult.stdout, /"type":"turn\.completed"/);
});

test("runs top is removed from the public command surface", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(["runs", "top"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /Did you mean (stop|show)/);
});
