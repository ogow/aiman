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
   await mkdir(path.join(homeRoot, ".aiman", "profiles"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "skills"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "runs"), { recursive: true });
   return homeRoot;
}

async function createProjectFixture(): Promise<string> {
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-project-"));
   await mkdir(path.join(projectRoot, ".aiman", "profiles"), {
      recursive: true
   });
   await mkdir(path.join(projectRoot, ".aiman", "skills"), {
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
for (let index = 0; index < process.argv.length; index += 1) {
   if (process.argv[index] === "--output-last-message") {
      lastMessagePath = process.argv[index + 1] ?? "";
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

process.stdout.write("provider stdout\\n");
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
      path.join(projectRoot, ".aiman", "profiles", "reviewer.md"),
      `---
name: reviewer
description: Reviews changes carefully
provider: codex
model: gpt-5.4-mini
mode: safe
reasoningEffort: medium
skills:
  - review-helper
---

## Role
You are a focused reviewer.

## Task Input
{{task}}

## Instructions
- Review the request carefully.
- Report the result clearly.

## Constraints
- Use only the attached project context and active skills.

## Expected Output
- Return a concise result.
`,
      "utf8"
   );
   await mkdir(path.join(projectRoot, ".aiman", "skills", "review-helper"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".aiman", "skills", "review-helper", "SKILL.md"),
      `---
name: review-helper
description: Adds review-specific guidance
keywords:
  - review
profiles:
  - reviewer
---

- Check correctness first.
- Keep the summary brief.
`,
      "utf8"
   );
   await mkdir(path.join(projectRoot, ".aiman", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".aiman", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: Helps with repo searching
keywords:
  - docs
  - search
modes:
  - safe
profiles:
  - reviewer
---

- Search the repo for the most relevant files before answering.
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
- The project keeps profiles under \`.aiman/profiles\`
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

test("profile list includes built-in build and plan profiles", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(["profile", "list", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      profiles: Array<{ isBuiltIn?: boolean; name: string }>;
   };

   assert.ok(payload.profiles.some((profile) => profile.name === "build"));
   assert.ok(payload.profiles.some((profile) => profile.name === "plan"));
});

test("profile create writes a project-scope profile", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(
      [
         "profile",
         "create",
         "auditor",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--mode",
         "safe",
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
   const createdPath = path.join(
      projectRoot,
      ".aiman",
      "profiles",
      "auditor.md"
   );
   const created = await readFile(createdPath, "utf8");
   assert.match(created, /name: auditor/);
   assert.match(created, /mode: safe/);
   assert.match(created, /reasoningEffort: medium/);
});

test("profile create rejects unsupported provider reasoning effort", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const createdPath = path.join(
      projectRoot,
      ".aiman",
      "profiles",
      "auditor.md"
   );
   const result = runCli(
      [
         "profile",
         "create",
         "auditor",
         "--scope",
         "project",
         "--provider",
         "gemini",
         "--mode",
         "safe",
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

test("profile check rejects unsupported legacy frontmatter", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "profiles", "legacy.md"),
      `---
name: legacy
description: Legacy profile
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

   const result = runCli(["profile", "check", "legacy"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /unsupported field "contextFiles"/);
});

test("run prompt includes AGENTS runtime context and active skills", async () => {
   const fixture = await createRunnableFixture();
   const runResult = runCli(
      [
         "run",
         "reviewer",
         "--task",
         "Review the docs",
         "--skill",
         "repo-search",
         "--json"
      ],
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
      ["run", "inspect", payload.runId, "--stream", "prompt"],
      {
         cwd: fixture.projectRoot,
         env: createCliEnv({
            binDir: fixture.binDir,
            homeRoot: fixture.homeRoot
         })
      }
   );

   assert.equal(promptResult.status, 0);
   assert.match(promptResult.stdout, /## Project Context/);
   assert.match(promptResult.stdout, /AGENTS\.md#Aiman Runtime Context/);
   assert.match(promptResult.stdout, /Build with `npm test`/);
   assert.doesNotMatch(promptResult.stdout, /Human Notes/);
   assert.match(promptResult.stdout, /## Active Skills/);
   assert.match(promptResult.stdout, /review-helper/);
   assert.match(promptResult.stdout, /repo-search/);

   const inspectResult = runCli(["run", "inspect", payload.runId, "--json"], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });

   assert.equal(inspectResult.status, 0);
   const inspectPayload = JSON.parse(inspectResult.stdout) as {
      launch: {
         projectContextPath?: string;
         skills: string[];
         task?: string;
      };
   };
   assert.equal(
      inspectPayload.launch.projectContextPath,
      "AGENTS.md#Aiman Runtime Context"
   );
   assert.deepEqual(inspectPayload.launch.skills, [
      "review-helper",
      "repo-search"
   ]);
   assert.equal(inspectPayload.launch.task, "Review the docs");
});

test("run list show and logs use the new run command surface", async () => {
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

   const listResult = runCli(["run", "list", "--all", "--json"], {
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

   const showResult = runCli(["run", "show", payload.runId], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });
   assert.equal(showResult.status, 0);
   assert.match(showResult.stdout, /Profile\s+reviewer/);
   assert.match(showResult.stdout, /Next steps/);

   const logsResult = runCli(["run", "logs", payload.runId], {
      cwd: fixture.projectRoot,
      env: createCliEnv({
         binDir: fixture.binDir,
         homeRoot: fixture.homeRoot
      })
   });
   assert.equal(logsResult.status, 0);
   assert.match(logsResult.stdout, /provider stdout/);
});

test("sesh top is removed from the public command surface", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   const result = runCli(["sesh", "top"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /Did you mean show/);
});
