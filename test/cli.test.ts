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
   await writeFile(
      lastMessagePath,
      "Fake codex result",
      "utf8"
   );
}

const runDir = process.env.AIMAN_RUN_DIR;
if (typeof runDir === "string" && runDir.length > 0) {
   await writeFile(
      path.join(runDir, "run.json"),
      JSON.stringify({
         agent: "fake",
         agentPath: "/fake/path",
         agentScope: "project",
         artifacts: [],
         cwd: process.cwd(),
         durationMs: 100,
         endedAt: new Date().toISOString(),
         exitCode: 0,
         launch: {},
         launchMode: "foreground",
         logs: { stderr: "", stdout: "" },
         finalText: "Fake result",
         outcome: "done",
         projectRoot: process.cwd(),
         provider: "codex",
         resultMode: "text",
         runId: "fake-id",
         schemaVersion: 1,
         startedAt: new Date().toISOString(),
         status: "success",
         summary: "Fake result",
         usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }
      }),
      "utf8"
   );
}

if (useJsonOutput) {
   process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
} else {
   process.stdout.write("Fake codex execution\\n");
}
`,
      "utf8"
   );

   if (process.platform === "win32") {
      await writeFile(
         launcherPath,
         `@echo off\nbun run "${scriptPath}" %*`,
         "utf8"
      );
   } else {
      await writeFile(
         launcherPath,
         `#!/bin/sh\nbun run "${scriptPath}" "$@"`,
         "utf8"
      );
      spawnSync("chmod", ["+x", launcherPath]);
   }
}

async function createRunnableFixture() {
   const homeRoot = await createHomeFixture();
   const projectRoot = await createProjectFixture();
   const binDir = path.join(projectRoot, "bin");
   await createFakeCodexBinary(binDir);

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
description: Reviews things
provider: codex
model: gpt-5.4-mini
reasoningEffort: medium
capabilities:
  - repo-grounded
  - read-only
---
Review this: {{task}}
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
      PATH: input.binDir
         ? `${input.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         : process.env.PATH,
      USERPROFILE: input.homeRoot
   };
}

test("no-arg aiman opens the app and requires a tty", async () => {
   const homeRoot = await createHomeFixture();
   const projectRoot = await createProjectFixture();

   const result = runCli([], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /requires an interactive TTY/);
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
         "tester",
         "--description",
         "Runs tests",
         "--instructions",
         "Run them",
         "--model",
         "gpt-5.4-mini",
         "--provider",
         "codex",
         "--reasoning-effort",
         "medium",
         "--scope",
         "project"
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.equal(result.status, 0);
   const agentPath = path.join(projectRoot, ".aiman", "agents", "tester.md");
   const content = await readFile(agentPath, "utf8");
   assert.match(content, /name: tester/);
   assert.match(content, /description: Runs tests/);
   assert.match(content, /## Stop Conditions/);
});

test("agent create writes informational capabilities when requested", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "cap-tester",
         "--description",
         "Runs tests",
         "--capability",
         "human-facing",
         "--capability",
         "repo-grounded",
         "--instructions",
         "Run them",
         "--model",
         "gpt-5.4-mini",
         "--provider",
         "codex",
         "--reasoning-effort",
         "medium",
         "--scope",
         "project"
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.equal(result.status, 0);
   const content = await readFile(
      path.join(projectRoot, ".aiman", "agents", "cap-tester.md"),
      "utf8"
   );
   assert.match(content, /capabilities:/);
   assert.match(content, /- "human-facing"/);
   assert.match(content, /- "repo-grounded"/);
});

test("agent create rejects unsupported provider reasoning effort", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "bad",
         "--description",
         "x",
         "--instructions",
         "x",
         "--model",
         "gemini-2.0-flash",
         "--provider",
         "gemini",
         "--reasoning-effort",
         "high",
         "--scope",
         "project"
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /has invalid reasoningEffort/);
});

test("agent create rejects missing reasoning-effort for Codex", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "missing",
         "--description",
         "x",
         "--instructions",
         "x",
         "--model",
         "gpt-5.4-mini",
         "--provider",
         "codex"
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
         "auto-gemini",
         "--description",
         "x",
         "--instructions",
         "x",
         "--model",
         "auto",
         "--provider",
         "gemini",
         "--reasoning-effort",
         "none",
         "--scope",
         "project"
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.equal(result.status, 0);
   const content = await readFile(
      path.join(projectRoot, ".aiman", "agents", "auto-gemini.md"),
      "utf8"
   );
   assert.match(content, /model: auto/);
});

test('agent create rejects "auto" model selection for Codex', async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "auto-codex",
         "--description",
         "x",
         "--instructions",
         "x",
         "--model",
         "auto",
         "--provider",
         "codex",
         "--reasoning-effort",
         "medium",
         "--scope",
         "project"
      ],
      {
         cwd: projectRoot,
         env: createCliEnv({ homeRoot })
      }
   );

   assert.notEqual(result.status, 0);
   assert.match(
      result.stderr,
      /Only Gemini supports automatic model selection/
   );
});

test("agent check allows Gemini to omit reasoningEffort", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "no-reasoning.md"),
      `---
name: no-reasoning
description: x
provider: gemini
model: gemini-2.0-flash
---
{{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "no-reasoning", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 0);
   const report = JSON.parse(result.stdout);
   assert.equal(report.profile.reasoningEffort, "none");
});

test("agent check warns when Stop Conditions are missing", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "missing-stop.md"),
      `---
name: missing-stop
description: x
provider: codex
model: gpt-5.4-mini
reasoningEffort: medium
---

## Role
You are a reviewer.

## Task Input
{{task}}

## Instructions
- Review the task.

## Constraints
- Stay focused.

## Expected Output
- Deliver the result.
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "missing-stop", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.equal(result.status, 0);
   const report = JSON.parse(result.stdout) as {
      status: string;
      warnings: Array<{ code: string }>;
   };
   assert.equal(report.status, "warnings");
   assert.ok(
      report.warnings.some((warning) => warning.code === "missing-stop-conditions-section")
   );
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
   assert.match(result.stderr, /unsupported field "mode"/);
});

test('agent check rejects legacy "mode" frontmatter even without other legacy fields', async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "legacy-mode.md"),
      `---
name: legacy-mode
description: Legacy mode agent
provider: codex
model: gpt-5.4-mini
mode: safe
reasoningEffort: medium
---

Legacy body {{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "legacy-mode"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /unsupported field "mode"/);
});

test("agent check rejects invalid capabilities frontmatter", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "bad-capabilities.md"),
      `---
name: bad-capabilities
description: x
provider: codex
model: gpt-5.4-mini
reasoningEffort: medium
capabilities: repo-grounded
---

## Task Input
{{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "check", "bad-capabilities"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });

   assert.notEqual(result.status, 0);
   assert.match(result.stderr, /invalid capabilities/);
});

test("agent show surfaces declared capabilities", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createHomeFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "cap-show.md"),
      `---
name: cap-show
description: x
provider: codex
model: gpt-5.4-mini
reasoningEffort: medium
capabilities:
  - human-facing
  - repo-grounded
---

## Role
You are a reviewer.

## Task Input
{{task}}

## Instructions
- Review the task.

## Constraints
- Stay focused.

## Stop Conditions
- Stop when you can answer clearly.

## Expected Output
- Deliver the result.
`,
      "utf8"
   );

   const humanResult = runCli(["agent", "show", "cap-show"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });
   assert.equal(humanResult.status, 0);
   assert.match(humanResult.stdout, /Capabilities/);
   assert.match(humanResult.stdout, /human-facing/);
   assert.match(humanResult.stdout, /repo-grounded/);

   const jsonResult = runCli(["agent", "show", "cap-show", "--json"], {
      cwd: projectRoot,
      env: createCliEnv({ homeRoot })
   });
   assert.equal(jsonResult.status, 0);
   const payload = JSON.parse(jsonResult.stdout) as {
      agent: { capabilities?: string[] };
   };
   assert.deepEqual(payload.agent.capabilities, [
      "human-facing",
      "repo-grounded"
   ]);
});

test("run prompt keeps native context out of the persisted prompt stream without implicit context files", async () => {
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
         capabilities?: string[];
         contextFiles?: string[];
         task?: string;
      };
   };
   assert.deepEqual(inspectPayload.launch.capabilities, [
      "repo-grounded",
      "read-only"
   ]);
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
   assert.match(result.stdout + result.stderr, /Did you mean (stop|show)/);
});
