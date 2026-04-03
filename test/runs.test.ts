import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { listRuns, readRunDetails, runAgent } from "../src/lib/runs.js";

async function createHomeFixture(): Promise<string> {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-"));
   await mkdir(path.join(homeRoot, ".aiman", "profiles"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "skills"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "runs"), { recursive: true });
   return homeRoot;
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
      `import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

let lastMessagePath = "";
for (let index = 0; index < process.argv.length; index += 1) {
   if (process.argv[index] === "--output-last-message") {
      lastMessagePath = process.argv[index + 1] ?? "";
   }
}

for await (const _ of process.stdin) {}

if (lastMessagePath.length > 0) {
   await mkdir(path.dirname(lastMessagePath), { recursive: true });
   await writeFile(lastMessagePath, "Fake codex result\\n", "utf8");
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
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-runs-"));
   const homeRoot = await createHomeFixture();
   const binDir = path.join(projectRoot, "bin");

   await mkdir(path.join(projectRoot, ".aiman", "profiles"), {
      recursive: true
   });
   await mkdir(path.join(projectRoot, ".aiman", "skills", "review-helper"), {
      recursive: true
   });
   await createFakeCodexBinary(binDir);
   await writeFile(
      path.join(projectRoot, ".aiman", "profiles", "reviewer.md"),
      `---
name: reviewer
description: Reviews code for risks
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
- Review the current change carefully.

## Constraints
- Use only the attached project context and active skills.

## Expected Output
- Return a concise result.
`,
      "utf8"
   );
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
`,
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      `# Router

## Human Notes
Ignore this section.

## Aiman Runtime Context
- Build with npm test
`,
      "utf8"
   );

   return { binDir, homeRoot, projectRoot };
}

function useProjectFixture(input: {
   binDir: string;
   homeRoot: string;
   projectRoot: string;
}): () => void {
   const originalCwd = process.cwd();
   const originalHome = process.env.HOME;
   const originalPath = process.env.PATH;
   const originalUserProfile = process.env.USERPROFILE;

   process.chdir(input.projectRoot);
   process.env.HOME = input.homeRoot;
   process.env.USERPROFILE = input.homeRoot;
   process.env.PATH = `${input.binDir}${path.delimiter}${originalPath ?? ""}`;

   return () => {
      process.chdir(originalCwd);

      if (originalHome === undefined) {
         delete process.env.HOME;
      } else {
         process.env.HOME = originalHome;
      }

      if (originalUserProfile === undefined) {
         delete process.env.USERPROFILE;
      } else {
         process.env.USERPROFILE = originalUserProfile;
      }

      if (originalPath === undefined) {
         delete process.env.PATH;
      } else {
         process.env.PATH = originalPath;
      }
   };
}

test("runAgent executes a profile and persists task context and skills", async () => {
   const fixture = await createRunnableFixture();
   const restore = useProjectFixture(fixture);

   try {
      const result = await runAgent({
         profileName: "reviewer",
         selectedSkillNames: ["review-helper"],
         task: "Review the docs"
      });

      assert.equal(result.status, "success");
      assert.equal(result.profile, "reviewer");
      assert.equal(result.mode, "safe");

      const run = await readRunDetails(result.runId);
      const prompt = await readFile(run.paths.promptFile, "utf8");

      assert.equal(
         run.launch.projectContextPath,
         "AGENTS.md#Aiman Runtime Context"
      );
      assert.deepEqual(run.launch.skills, ["review-helper"]);
      assert.equal(run.launch.task, "Review the docs");
      assert.match(prompt, /## Project Context/);
      assert.match(prompt, /## Active Skills/);
   } finally {
      restore();
   }
});

test("runAgent creates distinct run ids for repeated launches", async () => {
   const fixture = await createRunnableFixture();
   const restore = useProjectFixture(fixture);

   try {
      const first = await runAgent({
         profileName: "reviewer",
         task: "Review the first diff"
      });
      const second = await runAgent({
         profileName: "reviewer",
         task: "Review the second diff"
      });
      const runDirs = await readdir(
         path.join(fixture.homeRoot, ".aiman", "runs")
      );

      assert.notEqual(first.runId, second.runId);
      assert.ok(runDirs.includes(first.runId));
      assert.ok(runDirs.includes(second.runId));
   } finally {
      restore();
   }
});

test("listRuns returns persisted completed runs", async () => {
   const fixture = await createRunnableFixture();
   const restore = useProjectFixture(fixture);

   try {
      const result = await runAgent({
         profileName: "reviewer",
         task: "Review the latest patch"
      });
      const runs = await listRuns({ filter: "all" });

      assert.ok(runs.some((run) => run.runId === result.runId));
      const persisted = runs.find((run) => run.runId === result.runId);
      assert.equal(persisted?.active, false);
      assert.equal(persisted?.profile, "reviewer");
      assert.equal(persisted?.status, "success");
   } finally {
      restore();
   }
});
