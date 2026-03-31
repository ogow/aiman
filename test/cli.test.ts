import {
   mkdtemp,
   mkdir,
   readFile,
   readdir,
   realpath,
   writeFile
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

import {
   getNextRunFilter,
   getTopEmptyStateHint,
   getTopFilterSummary,
   getTopRunAge,
   getTopRunsPaneTitle
} from "../src/cmd/top.js";

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

function runGit(args: string[], cwd: string): void {
   const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8"
   });

   if (result.status === 0) {
      return;
   }

   throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`
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
   await mkdir(path.join(homeRoot, ".agents", "skills"), { recursive: true });
   return homeRoot;
}

async function createSkillFixture(input: {
   description: string;
   directory: string;
   name?: string;
}): Promise<void> {
   const skillName = input.name ?? path.basename(input.directory);

   await mkdir(path.join(input.directory, "references"), { recursive: true });
   await writeFile(
      path.join(input.directory, "SKILL.md"),
      `---
${typeof input.name === "string" ? `name: ${input.name}\n` : ""}description: ${input.description}
---

# ${skillName}
`,
      "utf8"
   );
   await writeFile(
      path.join(input.directory, "references", "guide.md"),
      `# ${skillName} guide
`,
      "utf8"
   );
}

async function createGitSkillRepoFixture(input: {
   initialBranch?: string;
   skills: Array<{
      description: string;
      directory?: string;
      name: string;
   }>;
}): Promise<string> {
   const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-skill-repo-"));

   for (const skill of input.skills) {
      await createSkillFixture({
         description: skill.description,
         directory: path.join(
            repoRoot,
            skill.directory ?? "skills",
            skill.name
         ),
         name: skill.name
      });
   }

   runGit(
      ["init", `--initial-branch=${input.initialBranch ?? "main"}`],
      repoRoot
   );
   runGit(["config", "user.email", "aiman-tests@example.com"], repoRoot);
   runGit(["config", "user.name", "Aiman Tests"], repoRoot);
   runGit(["add", "."], repoRoot);
   runGit(["commit", "-m", "Add skill bundle"], repoRoot);

   return repoRoot;
}

async function createGitRootSkillRepoFixture(input: {
   description: string;
   extraFiles?: Record<string, string>;
   initialBranch?: string;
   name?: string;
}): Promise<string> {
   const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-root-skill-"));

   await createSkillFixture({
      description: input.description,
      directory: repoRoot,
      ...(typeof input.name === "string" ? { name: input.name } : {})
   });

   for (const [relativePath, contents] of Object.entries(
      input.extraFiles ?? {}
   )) {
      const filePath = path.join(repoRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
   }

   runGit(
      ["init", `--initial-branch=${input.initialBranch ?? "main"}`],
      repoRoot
   );
   runGit(["config", "user.email", "aiman-tests@example.com"], repoRoot);
   runGit(["config", "user.name", "Aiman Tests"], repoRoot);
   runGit(["add", "."], repoRoot);
   runGit(["commit", "-m", "Add root skill bundle"], repoRoot);

   return repoRoot;
}

async function createRunnableProjectFixture(
   executableBody: string
): Promise<{ binDir: string; projectRoot: string }> {
   const projectRoot = await createProjectFixture();
   const binDir = path.join(projectRoot, "bin");

   await mkdir(binDir, { recursive: true });
   await writeFile(
      path.join(binDir, "codex"),
      `#!/bin/sh
LAST_MESSAGE_PATH=""
while [ "$#" -gt 0 ]
do
  if [ "$1" = "--output-last-message" ]
  then
    shift
    LAST_MESSAGE_PATH="$1"
  fi
  shift
done
write_last_message() {
  if [ -n "$LAST_MESSAGE_PATH" ]
  then
    printf '%s\\n' "$1" > "$LAST_MESSAGE_PATH"
  fi
}
${executableBody}
`,
      {
         encoding: "utf8",
         mode: 0o755
      }
   );
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   return { binDir, projectRoot };
}

async function createRunnableGeminiProjectFixture(
   executableBody: string
): Promise<{ binDir: string; projectRoot: string }> {
   const projectRoot = await createProjectFixture();
   const binDir = path.join(projectRoot, "bin");

   await mkdir(binDir, { recursive: true });
   await writeFile(
      path.join(binDir, "gemini"),
      `#!/bin/sh
${executableBody}
`,
      {
         encoding: "utf8",
         mode: 0o755
      }
   );
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "researcher.md"),
      `---
name: researcher
provider: gemini
description: Researches code and runtime behavior
permissions: read-only
model: gemini-2.5-pro
---

Task: {{task}}

Research the current change carefully.
`,
      "utf8"
   );

   return { binDir, projectRoot };
}

function sleep(durationMs: number): Promise<void> {
   return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
   });
}

async function waitForRunFile(
   projectRoot: string,
   runId: string,
   predicate: (content: string) => boolean,
   timeoutMs = 5000
): Promise<string> {
   const filePath = path.join(projectRoot, ".aiman", "runs", runId, "run.md");
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      try {
         const content = await readFile(filePath, "utf8");

         if (predicate(content)) {
            return content;
         }
      } catch {}

      await sleep(50);
   }

   throw new Error(`Timed out waiting for run file ${filePath}.`);
}

function renderLaunchFrontmatter(input: {
   agentName?: string;
   agentPath: string;
   cwd: string;
   envKeys?: string[];
   launchMode: "detached" | "foreground";
   mode: "read-only" | "workspace-write";
   promptTransport?: "arg" | "none" | "stdin";
   provider?: "codex" | "gemini";
}): string {
   const provider = input.provider ?? "codex";
   const promptTransport = input.promptTransport ?? "stdin";
   const envKeys = input.envKeys ?? [
      "AIMAN_ARTIFACTS_DIR",
      "AIMAN_RUN_DIR",
      "AIMAN_RUN_ID",
      "AIMAN_RUN_PATH",
      "PATH"
   ];
   const args =
      provider === "gemini"
         ? [
              "    - --prompt",
              "    - '@prompt.md'",
              "    - --approval-mode",
              `    - ${input.mode === "workspace-write" ? "auto_edit" : "plan"}`
           ]
         : [
              "    - exec",
              "    - --sandbox",
              `    - ${input.mode}`,
              "    - -a",
              "    - never",
              "    - --cd",
              `    - ${input.cwd}`,
              "    - --output-last-message",
              "    - /tmp/.codex-last-message.txt",
              "    - '-'"
           ];

   return [
      "launch:",
      "  agentDigest: test-agent-digest",
      `  agentName: ${input.agentName ?? "reviewer"}`,
      `  agentPath: ${input.agentPath}`,
      "  agentScope: project",
      "  args:",
      ...args,
      `  command: ${provider}`,
      `  cwd: ${input.cwd}`,
      "  envKeys:",
      ...envKeys.map((key) => `    - ${key}`),
      "  killGraceMs: 1000",
      `  launchMode: ${input.launchMode}`,
      `  mode: ${input.mode}`,
      `  permissions: ${input.mode}`,
      "  promptDigest: test-prompt-digest",
      `  promptTransport: ${promptTransport}`,
      `  provider: ${provider}`,
      "  skills: []",
      "  timeoutMs: 300000"
   ].join("\n");
}

test("prints help with no arguments", () => {
   const result = runCli([]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /aiman \[command\]/);
   assert.match(result.stdout, /agent <command>/);
   assert.match(result.stdout, /skill <command>/);
   assert.match(result.stdout, /run <agent>/);
   assert.match(result.stdout, /sesh <command>/);
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
   const result = runCli(["agent", "list", "--json"]);

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

test("fails when an agent file omits model", async () => {
   const projectRoot = await createProjectFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   const result = runCli(["agent", "list"], { cwd: projectRoot });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /Agent "reviewer" is missing a model/);
});

test("lists available skills with project-first precedence", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();

   await mkdir(path.join(projectRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: Project-specific repo search workflow
---

# Repo Search
`,
      "utf8"
   );
   await mkdir(path.join(projectRoot, ".agents", "skills", "summarizer"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".agents", "skills", "summarizer", "SKILL.md"),
      `---
name: summarizer
description: Summarize findings clearly
---

# Summarizer
`,
      "utf8"
   );
   await mkdir(path.join(homeRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(homeRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: User repo search workflow
---

# Repo Search
`,
      "utf8"
   );
   await mkdir(path.join(homeRoot, ".agents", "skills", "web-research"), {
      recursive: true
   });
   await writeFile(
      path.join(homeRoot, ".agents", "skills", "web-research", "SKILL.md"),
      `---
name: web-research
description: Research the web carefully
---

# Web Research
`,
      "utf8"
   );

   const result = runCli(["skill", "list", "--json"], {
      cwd: projectRoot,
      env: { HOME: homeRoot }
   });

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      skills: Array<{
         description: string;
         name: string;
         path: string;
         scope: string;
      }>;
   };

   assert.deepEqual(
      payload.skills.map((skill) => ({
         description: skill.description,
         name: skill.name,
         scope: skill.scope
      })),
      [
         {
            description: "Project-specific repo search workflow",
            name: "repo-search",
            scope: "project"
         },
         {
            description: "Summarize findings clearly",
            name: "summarizer",
            scope: "project"
         },
         {
            description: "Research the web carefully",
            name: "web-research",
            scope: "user"
         }
      ]
   );
});

test("ignores incomplete skill directories when listing skills", async () => {
   const projectRoot = await createProjectFixture();

   await mkdir(path.join(projectRoot, ".agents", "skills", "aiman", "agents"), {
      recursive: true
   });
   await mkdir(
      path.join(projectRoot, ".agents", "skills", "aiman", "references"),
      { recursive: true }
   );
   await mkdir(path.join(projectRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: Search the repository efficiently
---

# Repo Search
`,
      "utf8"
   );

   const result = runCli(["skill", "list", "--scope", "project", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      skills: Array<{
         description: string;
         name: string;
         path: string;
         scope: string;
      }>;
   };

   assert.deepEqual(
      payload.skills.map((skill) => ({
         description: skill.description,
         name: skill.name,
         scope: skill.scope
      })),
      [
         {
            description: "Search the repository efficiently",
            name: "repo-search",
            scope: "project"
         }
      ]
   );
});

test("renders a human-friendly agent list", () => {
   const result = runCli(["agent", "list"]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Agents/);
   assert.match(result.stdout, /Name\s+Scope\s+Provider\s+Description/);
   assert.match(result.stdout, /code-reviewer\s+project\s+codex/);
});

test("renders a human-friendly skill list", async () => {
   const projectRoot = await createProjectFixture();

   await mkdir(path.join(projectRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: Search the repository efficiently
---

# Repo Search
`,
      "utf8"
   );

   const result = runCli(["skill", "list"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Skills/);
   assert.match(result.stdout, /repo-search/);
   assert.match(result.stdout, /project/);
   assert.match(result.stdout, /Use these names in agent frontmatter/);
});

test("installs a local skill into project scope by default", async () => {
   const projectRoot = await createProjectFixture();
   const sourceDirectory = path.join(projectRoot, "skills", "repo-search");

   await createSkillFixture({
      description: "Project-specific repo search workflow",
      directory: sourceDirectory,
      name: "repo-search"
   });

   const result = runCli(
      ["skill", "install", "./skills/repo-search", "--json"],
      {
         cwd: projectRoot
      }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      installed: boolean;
      skill: { name: string; path: string; scope: string };
   };

   assert.equal(payload.installed, true);
   assert.equal(payload.skill.name, "repo-search");
   assert.equal(payload.skill.scope, "project");
   assert.equal(
      await realpath(payload.skill.path),
      await realpath(
         path.join(projectRoot, ".agents", "skills", "repo-search", "SKILL.md")
      )
   );
   assert.equal(
      await readFile(payload.skill.path, "utf8"),
      await readFile(path.join(sourceDirectory, "SKILL.md"), "utf8")
   );
   assert.equal(
      await readFile(
         path.join(
            projectRoot,
            ".agents",
            "skills",
            "repo-search",
            "references",
            "guide.md"
         ),
         "utf8"
      ),
      "# repo-search guide\n"
   );
});

test("installs a local skill into user scope", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();
   const sourceDirectory = path.join(projectRoot, "skills", "summarizer");

   await createSkillFixture({
      description: "Summarize findings clearly",
      directory: sourceDirectory,
      name: "summarizer"
   });

   const result = runCli(
      ["skill", "install", "./skills/summarizer", "--scope", "user", "--json"],
      {
         cwd: projectRoot,
         env: { HOME: homeRoot }
      }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      skill: { path: string; scope: string };
   };

   assert.equal(payload.skill.scope, "user");
   assert.equal(
      await realpath(payload.skill.path),
      await realpath(
         path.join(homeRoot, ".agents", "skills", "summarizer", "SKILL.md")
      )
   );
   assert.equal(
      await readFile(payload.skill.path, "utf8"),
      await readFile(path.join(sourceDirectory, "SKILL.md"), "utf8")
   );
});

test("installs a skill from a git URL by cloning the default branch and auto-detecting one bundled skill", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitSkillRepoFixture({
      skills: [
         {
            description: "Operate aiman safely",
            name: "aiman"
         }
      ]
   });

   const result = runCli(
      ["skill", "install", `file://${skillRepo}`, "--json"],
      { cwd: projectRoot }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      installed: boolean;
      skill: { name: string; path: string; scope: string };
   };

   assert.equal(payload.installed, true);
   assert.equal(payload.skill.name, "aiman");
   assert.equal(payload.skill.scope, "project");
   assert.equal(
      await readFile(payload.skill.path, "utf8"),
      await readFile(
         path.join(skillRepo, "skills", "aiman", "SKILL.md"),
         "utf8"
      )
   );
});

test("installs a skill from a git URL whose default branch is master", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitSkillRepoFixture({
      initialBranch: "master",
      skills: [
         {
            description: "Operate aiman safely",
            name: "aiman"
         }
      ]
   });

   const result = runCli(
      ["skill", "install", `file://${skillRepo}`, "--json"],
      { cwd: projectRoot }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      installed: boolean;
      skill: { name: string; path: string; scope: string };
   };

   assert.equal(payload.installed, true);
   assert.equal(payload.skill.name, "aiman");
   assert.equal(payload.skill.scope, "project");
   assert.equal(
      await readFile(payload.skill.path, "utf8"),
      await readFile(
         path.join(skillRepo, "skills", "aiman", "SKILL.md"),
         "utf8"
      )
   );
});

test("installs the default aiman skill when no source is provided", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitSkillRepoFixture({
      skills: [
         {
            description: "Operate aiman safely",
            name: "aiman"
         }
      ]
   });

   const result = runCli(["skill", "install", "--json"], {
      cwd: projectRoot,
      env: {
         AIMAN_DEFAULT_SKILL_SOURCE: `file://${skillRepo}`
      }
   });

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      installed: boolean;
      skill: { name: string; scope: string };
   };

   assert.equal(payload.installed, true);
   assert.equal(payload.skill.name, "aiman");
   assert.equal(payload.skill.scope, "project");
});

test("fails to auto-select a git skill when the repo bundles multiple skills", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitSkillRepoFixture({
      skills: [
         {
            description: "Operate aiman safely",
            name: "aiman"
         },
         {
            description: "Search the repo efficiently",
            name: "repo-search"
         }
      ]
   });

   const result = runCli(["skill", "install", `file://${skillRepo}`], {
      cwd: projectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /multiple bundled skills/i);
   assert.match(result.stderr, /--path skills\/<name>/);
});

test("installs one bundled skill from a git URL when --path is provided", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitSkillRepoFixture({
      skills: [
         {
            description: "Operate aiman safely",
            name: "aiman"
         },
         {
            description: "Search the repo efficiently",
            name: "repo-search"
         }
      ]
   });

   const result = runCli(
      [
         "skill",
         "install",
         `file://${skillRepo}`,
         "--path",
         "skills/repo-search",
         "--json"
      ],
      { cwd: projectRoot }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      skill: { name: string; scope: string };
   };

   assert.equal(payload.skill.name, "repo-search");
   assert.equal(payload.skill.scope, "project");
});

test("fails to install a skill when SKILL.md is missing", async () => {
   const projectRoot = await createProjectFixture();
   const sourceDirectory = path.join(projectRoot, "skills", "broken");

   await mkdir(sourceDirectory, { recursive: true });

   const result = runCli(["skill", "install", "./skills/broken"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /missing SKILL\.md/);
});

test("fails to install a skill over an existing target without --force", async () => {
   const projectRoot = await createProjectFixture();
   const sourceDirectory = path.join(projectRoot, "skills", "repo-search");

   await createSkillFixture({
      description: "Project-specific repo search workflow",
      directory: sourceDirectory,
      name: "repo-search"
   });
   await createSkillFixture({
      description: "Older installed copy",
      directory: path.join(projectRoot, ".agents", "skills", "repo-search"),
      name: "repo-search"
   });

   const result = runCli(["skill", "install", "./skills/repo-search"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /already exists/);
   assert.match(result.stderr, /--force/);
});

test("rejects unsafe install target names from skill frontmatter", async () => {
   const projectRoot = await createProjectFixture();

   for (const invalidName of [".", ".."]) {
      const sourceDirectory = path.join(
         projectRoot,
         "skills",
         invalidName === "." ? "dot-skill" : "dotdot-skill"
      );

      await createSkillFixture({
         description: "Unsafe test skill",
         directory: sourceDirectory,
         name: invalidName
      });

      const result = runCli(["skill", "install", sourceDirectory], {
         cwd: projectRoot
      });

      assert.equal(result.status, 1);
      assert.match(
         result.stderr,
         /invalid\. Use a single skill directory name/i
      );
   }

   await assert.rejects(
      readFile(path.join(projectRoot, ".agents", "SKILL.md"), "utf8")
   );
});

test("uses the source repo name for a root git skill when frontmatter omits name", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitRootSkillRepoFixture({
      description: "Install a repo-root skill without an explicit name"
   });

   const result = runCli(
      ["skill", "install", `file://${skillRepo}`, "--json"],
      { cwd: projectRoot }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      skill: { name: string; path: string };
   };

   assert.equal(payload.skill.name, path.basename(skillRepo));
   assert.equal(
      await realpath(payload.skill.path),
      await realpath(
         path.join(
            projectRoot,
            ".agents",
            "skills",
            path.basename(skillRepo),
            "SKILL.md"
         )
      )
   );
});

test("does not copy .git metadata when installing a repo-root git skill", async () => {
   const projectRoot = await createProjectFixture();
   const skillRepo = await createGitRootSkillRepoFixture({
      description: "Install a repo-root skill cleanly",
      extraFiles: {
         "README.md": "# Root skill repo\n"
      },
      name: "root-skill"
   });

   const result = runCli(
      ["skill", "install", `file://${skillRepo}`, "--json"],
      { cwd: projectRoot }
   );

   assert.equal(result.status, 0);

   const installedEntries = await readdir(
      path.join(projectRoot, ".agents", "skills", "root-skill")
   );

   assert.doesNotMatch(installedEntries.join("\n"), /\.git/);
   assert.match(installedEntries.join("\n"), /README\.md/);
   assert.match(installedEntries.join("\n"), /SKILL\.md/);
});

test("truncates long descriptions in human-facing list output", async () => {
   const projectRoot = await createProjectFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks with an intentionally long description that should be truncated in human tables to keep the output readable.
permissions: read-only
model: gpt-5.4
---

Task: {{task}}
`,
      "utf8"
   );
   await mkdir(path.join(projectRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(projectRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      `---
name: repo-search
description: Search the repository with an intentionally long description that should be truncated in human tables to keep the output readable.
---

# Repo Search
`,
      "utf8"
   );

   const agentList = runCli(["agent", "list"], { cwd: projectRoot });
   const skillList = runCli(["skill", "list"], { cwd: projectRoot });

   assert.equal(agentList.status, 0);
   assert.equal(skillList.status, 0);
   assert.match(agentList.stdout, /\.\.\./);
   assert.match(skillList.stdout, /\.\.\./);
   assert.doesNotMatch(
      agentList.stdout,
      /intentionally long description that should be truncated in human tables to keep the output readable\./
   );
   assert.doesNotMatch(
      skillList.stdout,
      /intentionally long description that should be truncated in human tables to keep the output readable\./
   );
});

test("shows an authored agent", () => {
   const result = runCli(["agent", "show", "code-reviewer", "--json"]);

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      agent: {
         body: string;
         path: string;
         permissions: string;
         provider: string;
         scope: string;
      };
      capabilities: {
         environmentSummary: string;
         modes: Array<{
            mode: string;
            providerControl: string;
            summary: string;
         }>;
      };
   };

   assert.equal(payload.agent.provider, "codex");
   assert.equal(payload.agent.scope, "project");
   assert.equal(payload.agent.permissions, "read-only");
   assert.match(payload.agent.path, /code-reviewer\.md$/);
   assert.match(payload.agent.body, /Review the current change carefully/);
   assert.deepEqual(
      payload.capabilities.modes.map((mode) => mode.mode),
      ["read-only", "workspace-write"]
   );
   assert.match(
      payload.capabilities.environmentSummary,
      /Allowlisted runtime environment/
   );
});

test("show describes provider rights in human output", () => {
   const result = runCli(["agent", "show", "code-reviewer"]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Rights/);
   assert.match(result.stdout, /read-only/);
   assert.match(result.stdout, /workspace-write/);
   assert.match(result.stdout, /--sandbox read-only/);
   assert.match(result.stdout, /Allowlisted runtime environment/);
});

test("shows an agent by the frontmatter name when the filename differs", async () => {
   const projectRoot = await createProjectFixture();
   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "file-name.md"),
      `---
name: listed-name
provider: codex
description: Listed by frontmatter name
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   const result = runCli(["agent", "show", "listed-name", "--json"], {
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
         "agent",
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
   assert.match(agentFile, /permissions: read-only/);
   assert.match(agentFile, /model: gpt-5.4/);
   assert.match(agentFile, /## Role/);
   assert.match(agentFile, /## Task Input/);
   assert.match(agentFile, /\{\{task\}\}/);
   assert.match(agentFile, /## Instructions/);
   assert.match(agentFile, /Prepare the release plan\./);
   assert.match(agentFile, /## Constraints/);
   assert.match(agentFile, /## Expected Output/);
   assert.match(result.stdout, /Created agent/);
   assert.match(result.stdout, /Name\s+release-helper/);
});

test("creates a user-scope agent in the home directory", async () => {
   const projectRoot = await createProjectFixture();
   const homeRoot = await createUserHomeFixture();

   const result = runCli(
      [
         "agent",
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
   assert.match(agentFile, /permissions: read-only/);
   assert.match(agentFile, /model: gemini-2.5-pro/);
   assert.match(result.stdout, /Scope\s+user/);
});

test("creates a codex agent with reasoning-effort", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
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

test("creates an agent with explicit workspace-write permissions", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "release-helper",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--permissions",
         "workspace-write",
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

   assert.match(agentFile, /permissions: workspace-write/);
});

test("fails to create an agent without a scope", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
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
   assert.match(result.stderr, /Missing required argument: scope/);
});

test("fails to create an agent without a provider", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
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
   assert.match(result.stderr, /Missing required argument: provider/);
});

test("fails to create an agent without a model", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
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
   assert.match(result.stderr, /Missing required argument: model/);
});

test("creates an agent from stdin instructions without prompting", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
         "create",
         "release-helper",
         "--scope",
         "project",
         "--provider",
         "codex",
         "--model",
         "gpt-5.4",
         "--description",
         "Helps with release tasks"
      ],
      {
         cwd: projectRoot,
         input: "Prepare the release plan.\nInclude rollout notes.\n"
      }
   );

   assert.equal(result.status, 0);

   const agentFile = await readFile(
      path.join(projectRoot, ".aiman", "agents", "release-helper.md"),
      "utf8"
   );

   assert.match(
      agentFile,
      /Prepare the release plan\.\nInclude rollout notes\./
   );
});

test("create prefers --instructions over stdin content", async () => {
   const projectRoot = await createProjectFixture();

   const result = runCli(
      [
         "agent",
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
         cwd: projectRoot,
         input: "Include rollout notes.\n"
      }
   );

   assert.equal(result.status, 0);
   assert.equal(result.stderr, "");

   const agentFile = await readFile(
      path.join(projectRoot, ".aiman", "agents", "release-helper.md"),
      "utf8"
   );

   assert.match(agentFile, /Prepare the release plan\./);
   assert.doesNotMatch(agentFile, /Include rollout notes\./);
});

test("create with --instructions does not wait for stdin to close", async () => {
   const projectRoot = await createProjectFixture();
   const child = spawn(
      process.execPath,
      [
         "--import",
         tsxImportPath,
         cliEntrypoint,
         "agent",
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
         cwd: projectRoot,
         env: process.env,
         stdio: ["pipe", "pipe", "pipe"]
      }
   );
   let stdout = "";
   let stderr = "";

   child.stdout.setEncoding("utf8");
   child.stderr.setEncoding("utf8");
   child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
   });
   child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
   });

   const exitCode = await Promise.race([
      new Promise<number | null>((resolve, reject) => {
         child.once("error", reject);
         child.once("exit", resolve);
      }),
      new Promise<symbol>((resolve) => {
         setTimeout(() => {
            resolve(Symbol("timeout"));
         }, 750);
      })
   ]);

   if (typeof exitCode !== "number") {
      child.kill("SIGKILL");
      assert.fail("create did not exit while stdin remained open");
   }

   assert.equal(exitCode, 0);
   assert.equal(stderr, "");
   assert.match(stdout, /Created agent/);
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
permissions: read-only
model: gpt-5.4
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
permissions: read-only
model: gpt-5.4
---

Review the shared changes.
`,
      "utf8"
   );

   const merged = runCli(["agent", "list", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });
   const filtered = runCli(["agent", "list", "--scope", "user", "--json"], {
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
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

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
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

Review the user changes.
`,
      "utf8"
   );

   const result = runCli(["agent", "show", "reviewer", "--json"], {
      cwd: projectRoot,
      env: {
         HOME: homeRoot
      }
   });
   const listResult = runCli(["agent", "list", "--json"], {
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
   const result = runCli(["agent", "show", "broken-agent"], {
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

test("fails when a runnable agent body omits the task placeholder", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );

   await writeFile(
      path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
---

Review the current change carefully.
`,
      "utf8"
   );

   const result = runCli(["run", "reviewer", "--task", "Review this"], {
      cwd: fixture.projectRoot,
      env: {
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(result.status, 1);
   assert.match(
      result.stderr,
      /must include the \{\{task\}\} placeholder in its body/
   );
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

test("fails when run mode conflicts with the agent permissions", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );

   const result = runCli(
      ["run", "reviewer", "--task", "Review this", "--mode", "workspace-write"],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 1);
   assert.match(
      result.stderr,
      /only allows read-only execution, but received --mode workspace-write/
   );
});

test("fails a run when a declared skill cannot be resolved", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );

   await writeFile(
      path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
skills:
  - missing-skill
---

Task: {{task}}
`,
      "utf8"
   );

   const result = runCli(["run", "reviewer", "--task", "Review this"], {
      cwd: fixture.projectRoot,
      env: {
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /requires skill "missing-skill"/);
});

test("run records the resolved project skill when project and user skills share a name", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const homeRoot = await createUserHomeFixture();

   await mkdir(
      path.join(fixture.projectRoot, ".agents", "skills", "repo-search"),
      {
         recursive: true
      }
   );
   await writeFile(
      path.join(
         fixture.projectRoot,
         ".agents",
         "skills",
         "repo-search",
         "SKILL.md"
      ),
      "# Project skill\n",
      "utf8"
   );
   await mkdir(path.join(homeRoot, ".agents", "skills", "repo-search"), {
      recursive: true
   });
   await writeFile(
      path.join(homeRoot, ".agents", "skills", "repo-search", "SKILL.md"),
      "# User skill\n",
      "utf8"
   );
   await writeFile(
      path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
skills:
  - repo-search
---

Task: {{task}}
`,
      "utf8"
   );

   const launch = runCli(
      ["run", "reviewer", "--task", "Review this", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            HOME: homeRoot,
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(launch.status, 0);

   const runPayload = JSON.parse(launch.stdout) as { runId: string };
   const inspect = runCli(["sesh", "inspect", runPayload.runId, "--json"], {
      cwd: fixture.projectRoot,
      env: {
         HOME: homeRoot,
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(inspect.status, 0);

   const payload = JSON.parse(inspect.stdout) as {
      launch: {
         skills: Array<{
            digest: string;
            name: string;
            path: string;
            scope: string;
         }>;
      };
   };

   assert.deepEqual(
      payload.launch.skills.map((skill) => skill.name),
      ["repo-search"]
   );
   assert.equal(payload.launch.skills[0]?.scope, "project");
   assert.match(
      payload.launch.skills[0]?.path ?? "",
      /\/\.agents\/skills\/repo-search\/SKILL\.md$/
   );
   assert.match(payload.launch.skills[0]?.digest ?? "", /^[a-f0-9]{64}$/);
});

test("run defaults to the agent permissions when no mode is provided", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );

   await writeFile(
      path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: workspace-write
model: gpt-5.4
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
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

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      launchMode: string;
      mode: string;
      rights: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.launchMode, "foreground");
   assert.equal(payload.mode, "workspace-write");
   assert.match(payload.rights, /read\/write workspace access/);
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
         "permissions: read-only",
         "model: gpt-5.4",
         "---",
         "",
         "Task: {{task}}",
         "",
         "Review the current change carefully.",
         ""
      ].join("\r\n"),
      "utf8"
   );

   const result = runCli(["agent", "show", "reviewer", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      agent: { name: string };
   };
   assert.equal(payload.agent.name, "reviewer");
});

test("shows declared skills from YAML block-list frontmatter", async () => {
   const projectRoot = await createProjectFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
skills:
  - repo-search
  - evidence-citation
---

Task: {{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "show", "reviewer", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      agent: { skills?: string[] };
   };

   assert.deepEqual(payload.agent.skills, ["repo-search", "evidence-citation"]);
});

test("shows declared required MCPs from YAML block-list frontmatter", async () => {
   const projectRoot = await createProjectFixture();

   await writeFile(
      path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
model: gpt-5.4
requiredMcps:
  - github
  - chrome-devtools
---

Task: {{task}}
`,
      "utf8"
   );

   const result = runCli(["agent", "show", "reviewer", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      agent: { requiredMcps?: string[] };
   };

   assert.deepEqual(payload.agent.requiredMcps, ["github", "chrome-devtools"]);
});

test("run --json returns the completed foreground result", async () => {
   const fixture = await createRunnableProjectFixture(
      `
sleep 1
write_last_message 'review complete'
echo 'review complete'
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

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      finalText: string;
      launchMode: string;
      rights: string;
      runId: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.launchMode, "foreground");
   assert.equal(payload.finalText, "review complete");
   assert.match(payload.rights, /read-only workspace access/);

   const persistedRun = await readFile(
      path.join(fixture.projectRoot, ".aiman", "runs", payload.runId, "run.md"),
      "utf8"
   );

   assert.match(persistedRun, /launchMode: foreground/);
});

test("prints only the final answer for a foreground run", async () => {
   const fixture = await createRunnableProjectFixture(
      `
sleep 1
write_last_message 'review complete'
echo 'review complete'
`
   );

   const result = runCli(["run", "reviewer", "--task", "Review this"], {
      cwd: fixture.projectRoot,
      env: {
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(result.status, 0);
   assert.equal(result.stderr, "");
   assert.equal(result.stdout, "review complete\n");
});

test("does not print a failure block for successful empty foreground output", async () => {
   const fixture = await createRunnableGeminiProjectFixture("exit 0");

   const result = runCli(["run", "researcher", "--task", "Review this"], {
      cwd: fixture.projectRoot,
      env: {
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(result.status, 0);
   assert.equal(result.stderr, "");
   assert.equal(result.stdout, "");
});

test("run --detach launches a detached managed run", async () => {
   const fixture = await createRunnableProjectFixture(
      `
echo 'first line'
sleep 1
write_last_message 'second line'
echo 'second line'
`
   );

   const result = runCli(
      ["run", "reviewer", "--task", "Review this", "--detach", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 0);
   const payload = JSON.parse(result.stdout) as {
      active: boolean;
      launchMode: string;
      logsCommand: string;
      pid?: number;
      rights: string;
      runId: string;
      showCommand: string;
      status: string;
   };

   assert.equal(payload.status, "running");
   assert.equal(payload.active, true);
   assert.equal(payload.launchMode, "detached");
   assert.equal(typeof payload.pid, "number");
   assert.match(payload.rights, /read-only workspace access/);
   assert.match(payload.logsCommand, /aiman sesh logs .* -f/);
   assert.match(payload.showCommand, /aiman sesh show /);

   const persistedRun = await waitForRunFile(
      fixture.projectRoot,
      payload.runId,
      (content) => /status: success/.test(content)
   );

   assert.match(persistedRun, /status: success/);
   assert.match(persistedRun, /launchMode: detached/);
});

test("detached run records failures in persisted status", async () => {
   const fixture = await createRunnableProjectFixture(
      `#!/bin/sh
echo 'simulated failure' >&2
exit 7
`
   );
   const result = runCli(
      ["run", "reviewer", "--task", "Review this", "--detach", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      launchMode: string;
      runId: string;
   };
   assert.equal(payload.launchMode, "detached");
   const persistedRun = await waitForRunFile(
      fixture.projectRoot,
      payload.runId,
      (content) => /status: error/.test(content)
   );

   assert.match(persistedRun, /status: error/);
   assert.match(persistedRun, /launchMode: detached/);
   assert.match(persistedRun, /errorMessage: simulated failure/);
});

test("run --detach fails cleanly when the supervisor cannot spawn", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );

   const result = runCli(
      [
         "run",
         "reviewer",
         "--task",
         "Review this",
         "--detach",
         "--json",
         "--cwd",
         "does-not-exist"
      ],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );

   assert.equal(result.status, 1);
   assert.match(result.stderr, /could not be launched/);

   const runDirs = await readdir(
      path.join(fixture.projectRoot, ".aiman", "runs")
   );

   assert.equal(runDirs.length, 1);

   const persistedRun = await readFile(
      path.join(fixture.projectRoot, ".aiman", "runs", runDirs[0]!, "run.md"),
      "utf8"
   );

   assert.match(persistedRun, /status: error/);
});

test("run resolves both scopes and prefers the project agent by default", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
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
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

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
      agentPath: string;
      agentScope: string;
      launchMode: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.launchMode, "foreground");
   assert.equal(payload.agentScope, "project");
   assert.match(payload.agentPath, /\/\.aiman\/agents\/reviewer\.md$/);
});

test("run --scope user bypasses project precedence", async () => {
   const fixture = await createRunnableProjectFixture(
      `
write_last_message 'ok'
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
permissions: read-only
model: gpt-5.4
---

Task: {{task}}

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
      agentPath: string;
      agentScope: string;
      launchMode: string;
      status: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.launchMode, "foreground");
   assert.equal(payload.agentScope, "user");
   assert.match(payload.agentPath, /\/\.aiman\/agents\/reviewer\.md$/);
});

test("inspects the full persisted run record", () => {
   const result = runCli([
      "sesh",
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
      active: boolean;
      launch: {
         agentDigest: string;
         command: string;
         envKeys: string[];
         promptDigest: string;
         promptTransport: string;
         skills: Array<{
            digest: string;
            name: string;
            path: string;
            scope: string;
         }>;
      };
      launchMode: string;
      paths: { promptFile: string; runFile: string };
      status: string;
      warning?: string;
   };

   assert.equal(payload.status, "success");
   assert.equal(payload.active, false);
   assert.equal(payload.launchMode, "foreground");
   assert.equal(payload.warning, undefined);
   assert.equal(payload.agentScope, "project");
   assert.equal(payload.agentPath, "/repo/.aiman/agents/code-reviewer.md");
   assert.equal(payload.finalText, "Final review summary");
   assert.equal(payload.launch.command, "codex");
   assert.equal(payload.launch.promptTransport, "stdin");
   assert.equal(payload.launch.agentDigest, "fixture-agent-digest");
   assert.equal(payload.launch.promptDigest, "fixture-prompt-digest");
   assert.deepEqual(payload.launch.skills, [
      {
         digest: "fixture-skill-digest",
         name: "repo-search",
         path: "/repo/.agents/skills/repo-search/SKILL.md",
         scope: "project"
      }
   ]);
   assert.deepEqual(payload.launch.envKeys, [
      "AIMAN_ARTIFACTS_DIR",
      "AIMAN_RUN_DIR",
      "AIMAN_RUN_ID",
      "AIMAN_RUN_PATH",
      "OPENAI_API_KEY",
      "PATH"
   ]);
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
      "sesh",
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--stream",
      "stderr"
   ]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /review warning/);
});

test("renders a human-friendly status summary", () => {
   const result = runCli(["sesh", "show", "20260328T143012Z-code-reviewer"]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Status/);
   assert.match(result.stdout, /Active\s+no/);
   assert.match(result.stdout, /Recorded status\s+success/);
   assert.match(result.stdout, /Launch\s+foreground/);
   assert.match(result.stdout, /Rights\s+read-only workspace access/);
   assert.match(result.stdout, /Final answer/);
   assert.match(result.stdout, /Final review summary/);
   assert.match(result.stdout, /Next steps/);
});

test("renders a detailed inspect summary", () => {
   const result = runCli(["sesh", "inspect", "20260328T143012Z-code-reviewer"]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Run/);
   assert.match(result.stdout, /Recorded status\s+success/);
   assert.match(result.stdout, /Launch\s+foreground/);
   assert.match(result.stdout, /Rights\s+read-only workspace access/);
   assert.match(result.stdout, /Agent digest\s+fixture-agent-digest/);
   assert.match(result.stdout, /Prompt digest\s+fixture-prompt-digest/);
   assert.match(result.stdout, /Command\s+codex/);
   assert.match(result.stdout, /Files/);
   assert.match(result.stdout, /Document frontmatter/);
   assert.match(result.stdout, /Artifacts/);
});

test("ps lists only active runs by default", async () => {
   const projectRoot = await createProjectFixture();
   const liveRunId = "20260330T190000Z-live-reviewer";
   const staleRunId = "20260330T185500Z-stale-reviewer";
   const liveRunDir = path.join(projectRoot, ".aiman", "runs", liveRunId);
   const staleRunDir = path.join(projectRoot, ".aiman", "runs", staleRunId);
   const liveHeartbeatAt = new Date().toISOString();
   const staleHeartbeatAt = new Date(Date.now() - 60_000).toISOString();

   await mkdir(liveRunDir, { recursive: true });
   await mkdir(staleRunDir, { recursive: true });
   await writeFile(
      path.join(liveRunDir, "run.md"),
      `---
runId: ${liveRunId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${projectRoot}
startedAt: 2026-03-30T19:00:00.000Z
pid: ${process.pid}
heartbeatAt: ${liveHeartbeatAt}
${renderLaunchFrontmatter({
   agentPath: path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: projectRoot,
   launchMode: "foreground",
   mode: "read-only"
})}
---
`,
      "utf8"
   );
   await writeFile(
      path.join(staleRunDir, "run.md"),
      `---
runId: ${staleRunId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: detached
mode: read-only
cwd: ${projectRoot}
startedAt: 2026-03-30T18:55:00.000Z
pid: 999999
heartbeatAt: ${staleHeartbeatAt}
${renderLaunchFrontmatter({
   agentPath: path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: projectRoot,
   launchMode: "detached",
   mode: "read-only"
})}
---
`,
      "utf8"
   );

   const result = runCli(["sesh", "list", "--json"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);

   const payload = JSON.parse(result.stdout) as {
      runs: Array<{
         active: boolean;
         launchMode: string;
         runId: string;
         status: string;
      }>;
   };

   assert.deepEqual(
      payload.runs.map((run) => run.runId),
      [liveRunId]
   );
   assert.equal(payload.runs[0]?.active, true);
   assert.equal(payload.runs[0]?.launchMode, "foreground");
   assert.equal(payload.runs[0]?.status, "running");
});

test("status shows an incomplete warning when the process no longer exists", async () => {
   const projectRoot = await createProjectFixture();
   const runId = "20260330T191500Z-stale-reviewer";
   const runDir = path.join(projectRoot, ".aiman", "runs", runId);
   const staleHeartbeatAt = new Date(Date.now() - 60_000).toISOString();

   await mkdir(runDir, { recursive: true });
   await writeFile(
      path.join(runDir, "run.md"),
      `---
runId: ${runId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: detached
mode: read-only
cwd: ${projectRoot}
startedAt: 2026-03-30T19:15:00.000Z
pid: 999999
heartbeatAt: ${staleHeartbeatAt}
${renderLaunchFrontmatter({
   agentPath: path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: projectRoot,
   launchMode: "detached",
   mode: "read-only"
})}
---
`,
      "utf8"
   );

   const result = runCli(["sesh", "show", runId], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   assert.match(result.stdout, /Recorded status\s+running/);
   assert.match(result.stdout, /Active\s+no/);
   assert.match(result.stdout, /Launch\s+detached/);
   assert.match(
      result.stdout,
      /Process exited before terminal record was written\./
   );
});

test("logs reads recent output and follow mode waits for completion", async () => {
   const fixture = await createRunnableProjectFixture(
      `
echo 'first'
sleep 1
write_last_message 'second'
echo 'second'
`
   );
   const launch = runCli(
      ["run", "reviewer", "--task", "Review this", "--detach", "--json"],
      {
         cwd: fixture.projectRoot,
         env: {
            PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
         }
      }
   );
   const payload = JSON.parse(launch.stdout) as {
      runId: string;
   };

   const result = runCli(["sesh", "logs", payload.runId, "-f"], {
      cwd: fixture.projectRoot,
      env: {
         PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
   });

   assert.equal(result.status, 0);
   assert.match(result.stdout, /first/);
   assert.match(result.stdout, /second/);
});

test("logs --tail 0 does not print persisted output", async () => {
   const projectRoot = await createProjectFixture();
   const runId = "20260330T193500Z-reviewer";
   const runDir = path.join(projectRoot, ".aiman", "runs", runId);

   await mkdir(runDir, { recursive: true });
   await writeFile(
      path.join(runDir, "run.md"),
      `---
runId: ${runId}
status: success
agent: reviewer
agentScope: project
agentPath: ${path.join(projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${projectRoot}
startedAt: 2026-03-30T19:35:00.000Z
endedAt: 2026-03-30T19:35:02.000Z
durationMs: 2000
exitCode: 0
signal: null
${renderLaunchFrontmatter({
   agentPath: path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: projectRoot,
   launchMode: "foreground",
   mode: "read-only"
})}
---
Done.
`,
      "utf8"
   );
   await writeFile(path.join(runDir, "stdout.log"), "first\nsecond\n", "utf8");

   const result = runCli(["sesh", "logs", runId, "--tail", "0"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 0);
   assert.equal(result.stdout, "");
});

test("logs fails clearly when the run does not exist", async () => {
   const projectRoot = await createProjectFixture();

   const humanResult = runCli(["sesh", "logs", "does-not-exist"], {
      cwd: projectRoot
   });
   const jsonResult = runCli(["sesh", "logs", "does-not-exist", "--json"], {
      cwd: projectRoot
   });

   assert.equal(humanResult.status, 1);
   assert.match(humanResult.stderr, /Run "does-not-exist" was not found/);
   assert.equal(jsonResult.status, 1);
   assert.match(jsonResult.stderr, /Run "does-not-exist" was not found/);
});

test("top requires an interactive tty", async () => {
   const projectRoot = await createProjectFixture();
   const runId = "20260330T192500Z-live-reviewer";
   const runDir = path.join(projectRoot, ".aiman", "runs", runId);

   await mkdir(runDir, { recursive: true });
   await writeFile(
      path.join(runDir, "run.md"),
      `---
runId: ${runId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${projectRoot}
startedAt: 2026-03-30T19:25:00.000Z
pid: ${process.pid}
${renderLaunchFrontmatter({
   agentPath: path.join(projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: projectRoot,
   launchMode: "foreground",
   mode: "read-only"
})}
---
`,
      "utf8"
   );

   const result = runCli(["sesh", "top"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /requires an interactive TTY/);
});

test("top accepts historic and all filters before tty validation", async () => {
   const projectRoot = await createProjectFixture();

   const historicResult = runCli(["sesh", "top", "--filter", "historic"], {
      cwd: projectRoot
   });
   const allResult = runCli(["sesh", "top", "--filter", "all"], {
      cwd: projectRoot
   });

   assert.equal(historicResult.status, 1);
   assert.match(historicResult.stderr, /requires an interactive TTY/);
   assert.equal(allResult.status, 1);
   assert.match(allResult.stderr, /requires an interactive TTY/);
});

test("top rejects unsupported filter values", async () => {
   const projectRoot = await createProjectFixture();
   const result = runCli(["sesh", "top", "--filter", "finished"], {
      cwd: projectRoot
   });

   assert.equal(result.status, 1);
   assert.match(result.stderr, /filter/i);
   assert.match(result.stderr, /active/);
   assert.match(result.stderr, /historic/);
   assert.doesNotMatch(result.stderr, /requires an interactive TTY/);
});

test("top filter helpers describe the current view", () => {
   assert.equal(getTopFilterSummary("active"), "active only");
   assert.equal(getTopFilterSummary("historic"), "historic only");
   assert.equal(getTopFilterSummary("all"), "all runs");

   assert.equal(getTopRunsPaneTitle("active"), "Runs (active)");
   assert.equal(getTopRunsPaneTitle("historic"), "Runs (historic)");
   assert.equal(getTopRunsPaneTitle("all"), "Runs (all)");

   assert.equal(
      getTopEmptyStateHint("active"),
      "Press f for historic and all runs."
   );
   assert.equal(
      getTopEmptyStateHint("historic"),
      "Press f for all runs or back to active."
   );
   assert.equal(
      getTopEmptyStateHint("all"),
      "Create or run an agent to populate the dashboard."
   );
});

test("top filter helper cycles active historic and all", () => {
   assert.equal(getNextRunFilter("active"), "historic");
   assert.equal(getNextRunFilter("historic"), "all");
   assert.equal(getNextRunFilter("all"), "active");
});

test("top age helper freezes completed runs at their recorded duration", () => {
   assert.equal(
      getTopRunAge(
         {
            durationMs: 2_000,
            startedAt: "2026-03-30T19:35:00.000Z"
         },
         Date.parse("2026-03-30T19:40:00.000Z")
      ),
      "2s"
   );
   assert.equal(
      getTopRunAge(
         {
            endedAt: "2026-03-30T19:35:02.000Z",
            startedAt: "2026-03-30T19:35:00.000Z"
         },
         Date.parse("2026-03-30T19:40:00.000Z")
      ),
      "2s"
   );
   assert.equal(
      getTopRunAge(
         {
            startedAt: "2026-03-30T19:35:00.000Z"
         },
         Date.parse("2026-03-30T19:35:05.000Z")
      ),
      "5s"
   );
});

test("reads the persisted prompt through inspect", () => {
   const result = runCli([
      "sesh",
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
      "sesh",
      "inspect",
      "20260328T143012Z-code-reviewer",
      "--stream",
      "run"
   ]);

   assert.equal(result.status, 0);
   assert.match(result.stdout, /runId: 20260328T143012Z-code-reviewer/);
});
