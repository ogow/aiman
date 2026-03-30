import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntrypoint = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsxImportPath = import.meta.resolve("tsx");
const fixtureProjectRoot = fileURLToPath(
   new URL("./fixtures/project/", import.meta.url)
);
const invalidProjectRoot = fileURLToPath(
   new URL("./fixtures/invalid-project/", import.meta.url)
);

function runCli(
   args: string[],
   options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      input?: string;
   }
) {
   return spawnSync(
      process.execPath,
      ["--import", tsxImportPath, cliEntrypoint, ...args],
      {
         cwd: options?.cwd ?? fixtureProjectRoot,
         env:
            options?.env === undefined
               ? process.env
               : {
                    ...process.env,
                    ...options.env
                 },
         encoding: "utf8",
         input: options?.input
      }
   );
}

async function createProjectFixture(): Promise<string> {
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-cli-"));
   await mkdir(path.join(projectRoot, ".aiman", "agents"), { recursive: true });
   return projectRoot;
}

async function createUserHomeFixture(): Promise<string> {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-"));
   await mkdir(path.join(homeRoot, ".aiman", "agents"), { recursive: true });
   return homeRoot;
}

async function createRunnableProjectFixture(
   executableBody: string
): Promise<{ binDir: string; projectRoot: string }> {
   const projectRoot = await createProjectFixture();
   const binDir = path.join(projectRoot, "bin");

   await mkdir(binDir, { recursive: true });
   await writeFile(path.join(binDir, "codex"), executableBody, {
      encoding: "utf8",
      mode: 0o755
   });
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
---

Review the current change carefully.
`,
      "utf8"
   );

   return { binDir, projectRoot };
}

test("prints help with no arguments", () => {
   const result = runCli([]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /aiman \[command\]/);
   assert.match(result.stdout, /list/);
   assert.match(result.stdout, /show <agent>/);
   assert.match(result.stdout, /create <name>/);
   assert.match(result.stdout, /run <agent>/);
   assert.match(result.stdout, /inspect <runId>/);
});

test("prints the package version", async () => {
   const packageJsonRaw = await readFile(
      path.join(repositoryRoot, "package.json"),
      "utf8"
   );
   const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown };
   const expectedVersion =
      typeof packageJson.version === "string" ? packageJson.version : undefined;

   const result = runCli(["--version"]);

   assert.equal(result.status, 0);
   assert.equal(result.stdout.trim(), expectedVersion);
});

test("fails on unknown commands", () => {
   const result = runCli(["unknown-command"]);

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Unknown argument|Unknown command|Did you mean/);
});

test("lists authored agents", () => {
   const result = runCli(["list", "--json"]);

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agents: Array<{
         name: string;
         path: string;
         provider: string;
         scope: string;
      }>;
   };

   assert.deepEqual(
      payload.agents.map((agent) => agent.name),
      ["code-reviewer", "researcher"]
   );
   assert.deepEqual(
      payload.agents.map((agent) => agent.scope),
      ["project", "project"]
   );
   assert.match(payload.agents[0]?.path ?? "", /\.md$/);
});

test("shows an authored agent", () => {
   const result = runCli(["show", "code-reviewer", "--json"]);

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agent: { body: string; path: string; provider: string; scope: string };
   };

   assert.equal(payload.agent.provider, "codex");
   assert.equal(payload.agent.scope, "project");
   assert.match(payload.agent.path, /code-reviewer\.md$/);
   assert.match(payload.agent.body, /Review the current change carefully/);
});

test("shows an agent by the frontmatter name when the filename differs", async () => {
   const projectRoot = await createProjectFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "file-name.md"),
      `---
name: listed-name
provider: codex
description: Listed by frontmatter name
---

Review the current change carefully.
`,
      "utf8"
   );

   const result = runCli(["show", "listed-name", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agent: { name: string };
   };

   assert.equal(payload.agent.name, "listed-name");
});

test("creates a project-scope agent with structured instructions", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan."
      ],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 0);

   const agentFile = await readFile(
      path.join(projectRoot, ".aiman", "agents", "release-helper.md"),
      "utf8"
   );

   assert.match(agentFile, /name: release-helper/);
   assert.match(agentFile, /provider: codex/);
   assert.match(agentFile, /model: gpt-5.4/);
   assert.match(agentFile, /## Role/);
   assert.match(agentFile, /## Primary Task/);
   assert.match(agentFile, /Prepare the release plan\./);
   assert.match(agentFile, /## Constraints/);
   assert.match(agentFile, /## Expected Output/);
});

test("creates a user-scope agent in the home directory", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--scope",
         "user",
         "--provider",
         "gemini",
         "--model",
         "gemini-2.5-pro",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan."
      ],
      {
         cwd: projectRoot,
         env: {
            HOME: homeRoot
         }
      }
   );

   assert.equal(result.status, 0);

   const agentFile = await readFile(
      path.join(homeRoot, ".aiman", "agents", "release-helper.md"),
      "utf8"
   );

   assert.match(agentFile, /name: release-helper/);
   assert.match(agentFile, /provider: gemini/);
   assert.match(agentFile, /model: gemini-2.5-pro/);
   assert.match(result.stdout, /scope: user/);
});

test("creates a codex agent with reasoning-effort", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan.",
         "--reasoning-effort",
         "high"
      ],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 0);

   const agentFile = await readFile(
      path.join(projectRoot, ".aiman", "agents", "release-helper.md"),
      "utf8"
   );

   assert.match(agentFile, /reasoningEffort: high/);
});

test("fails to create an agent without a scope", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan."
      ],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Agent scope is required/);
});

test("fails to create an agent without a provider", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--scope",
         "project",
         "--model",
         "gpt-5.4",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan."
      ],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Agent provider is required/);
});

test("fails to create an agent without a model", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "create",
         "release-helper",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--description",
         "Helps with release tasks",
         "--instructions",
         "Prepare the release plan."
      ],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Agent model is required/);
});

test("lists project and user agents together and filters by scope", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "project-reviewer.md"),
      `---
name: project-reviewer
provider: codex
description: Project reviewer
---

Review the project changes.
`,
      "utf8"
   );
   await writeFile(
      path.join(homeRoot, ".aiman", "agents", "user-reviewer.md"),
      `---
name: user-reviewer
provider: codex
description: User reviewer
---

Review the shared changes.
`,
      "utf8"
   );

   const merged = runCli(["list", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });
   const filtered = runCli(["list", "--scope", "user", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });

   assert.equal(merged.status, 0);
   assert.equal(filtered.status, 0);

   const mergedPayload = JSON.parse(merged.stdout) as {
      agents: Array<{ name: string; scope: string }>;
   };
   const filteredPayload = JSON.parse(filtered.stdout) as {
      agents: Array<{ name: string; scope: string }>;
   };

   assert.deepEqual(
      mergedPayload.agents.map((agent) => [agent.scope, agent.name]),
      [
         ["project", "project-reviewer"],
         ["user", "user-reviewer"]
      ]
   );
   assert.deepEqual(
      filteredPayload.agents.map((agent) => [agent.scope, agent.name]),
      [["user", "user-reviewer"]]
   );
});

test("prefers the project agent when both scopes define the same name", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Project reviewer
---

Review the project changes.
`,
      "utf8"
   );
   await writeFile(
      path.join(homeRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: User reviewer
---

Review the user changes.
`,
      "utf8"
   );

   const result = runCli(["show", "reviewer", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });
   const listResult = runCli(["list", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });

   assert.equal(result.status, 0);
   assert.equal(listResult.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agent: { path: string; scope: string };
   };
   const listPayload = JSON.parse(listResult.stdout) as {
      agents: Array<{ name: string; scope: string }>;
   };

   assert.equal(payload.agent.scope, "project");
   assert.match(payload.agent.path, /\/\.aiman\/agents\/reviewer\.md$/);
   assert.deepEqual(
      listPayload.agents.map((agent) => [agent.scope, agent.name]),
      [["project", "reviewer"]]
   );
});

test("fails when showing an invalid agent file", () => {
   const result = runCli(["show", "broken-agent"], {
      cwd: invalidProjectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /unsupported provider: missing/i);
});

test("fails when run input is missing", () => {
   const result = runCli(["run", "code-reviewer"]);

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Provide task input with --task or stdin/);
});

test("fails when task is supplied through both --task and stdin", () => {
   const result = runCli(["run", "code-reviewer", "--task", "Review this"], {
      input: "Also review this"
   });

   assert.equal(result.status, 1);
   assert.match(
      result.stderr,
      /Provide task input with --task or stdin, not both/
   );
});

test("accepts CRLF frontmatter in agent files", async () => {
   const projectRoot = await createProjectFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      [
         "---",
         "name: reviewer",
         "provider: codex",
         "description: Reviews code for risks",
         "---",
         "",
         "Review the current change carefully.",
         ""
      ].join("\r\n"),
      "utf8"
   );

   const result = runCli(["show", "reviewer", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      agent: { name: string };
   };
   assert.equal(payload.agent.name, "reviewer");
});

test("exits non-zero when an authored run fails", async () => {
   const fixture = await createRunnableProjectFixture(
      `#!/bin/sh
echo 'simulated failure' >&2
exit 7
`
   );
   const result = runCli(
      ["run", "reviewer", "--task", "Review this", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 1);
   const payload = JSON.parse(result.stdout) as {
      errorMessage?: string;
      status: string;
   };
   assert.equal(payload.status, "error");
   assert.equal(payload.errorMessage, "simulated failure");
});

test("run resolves both scopes and prefers the project agent by default", async () => {
   const fixture = await createRunnableProjectFixture(
      `#!/bin/sh
echo 'ok'
`
   );
   const homeRoot = await createUserHomeFixture();

   await writeFile(
      path.join(homeRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: User reviewer
---

Review the current user change carefully.
`,
      "utf8"
   );

   const result = runCli(
      ["run", "reviewer", "--task", "Review this", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            HOME: homeRoot,
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agentPath?: string;
      agentScope?: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.agentScope, "project");
   assert.match(payload.agentPath ?? "", /\/\.aiman\/agents\/reviewer\.md$/);
});

test("run --scope user bypasses project precedence", async () => {
   const fixture = await createRunnableProjectFixture(
      `#!/bin/sh
echo 'ok'
`
   );
   const homeRoot = await createUserHomeFixture();

   await writeFile(
      path.join(homeRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: User reviewer
---

Review the current user change carefully.
`,
      "utf8"
   );

   const result = runCli(
      ["run", "reviewer", "--scope", "user", "--task", "Review this", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            HOME: homeRoot,
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agentPath?: string;
      agentScope?: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.agentScope, "user");
   assert.match(payload.agentPath ?? "", /\/\.aiman\/agents\/reviewer\.md$/);
});

test("inspects the full persisted run record", () => {
   const result = runCli([
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--json"
   ]);

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agentPath: string;
      agentScope: string;
      document: {
         artifacts: Array<{ exists: boolean; path: string }>;
         frontmatter?: { kind?: string; summary?: string };
         path: string;
      };
      finalText: string;
      paths: { promptFile: string; runFile: string };
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.agentScope, "project");
   assert.equal(payload.agentPath, "/repo/.aiman/agents/code-reviewer.md");
   assert.equal(payload.finalText, "Final review summary");
   assert.match(payload.paths.promptFile, /prompt\.md$/);
   assert.match(payload.paths.runFile, /run\.md$/);
   assert.equal(payload.document.frontmatter?.kind, "code-review");
   assert.equal(
      payload.document.frontmatter?.summary,
      "Reviewed the current patch"
   );
   assert.match(payload.document.path, /run\.md$/);
   assert.deepEqual(payload.document.artifacts, [
      {
         exists: true,
         kind: "diff-note",
         label: "review note",
         path: "review-note.txt",
         resolvedPath: path.join(
            fixtureProjectRoot,
            ".aiman",
            "runs",
            "20260328T143012Z-code-reviewer",
            "artifacts",
            "review-note.txt"
         )
      }
   ]);
});

test("reads persisted stderr logs through inspect", () => {
   const result = runCli([
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--stream",
      "stderr"
   ]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /review warning/);
});

test("reads the persisted prompt through inspect", () => {
   const result = runCli([
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--stream",
      "prompt"
   ]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Review the current change carefully/);
});

test("reads the persisted run file through inspect", () => {
   const result = runCli([
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--stream",
      "run"
   ]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /runId: 20260328T143012Z-code-reviewer/);
});

test("renders a human summary for inspect by default", () => {
   const result = runCli(["inspect", "20260328T143012Z-code-reviewer"]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /runId: 20260328T143012Z-code-reviewer/);
   assert.match(result.stdout, /agentScope: project/);
   assert.match(
      result.stdout,
      /agentPath: \/repo\/\.aiman\/agents\/code-reviewer\.md/
   );
   assert.match(result.stdout, /finalText:/);
   assert.match(
      result.stdout,
      /Use "aiman inspect 20260328T143012Z-code-reviewer --stream run"/
   );
   assert.match(
      result.stdout,
      /Use "aiman inspect 20260328T143012Z-code-reviewer --stream prompt"/
   );
});
