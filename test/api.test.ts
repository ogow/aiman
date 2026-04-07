import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test } from "bun:test";

import { createAiman } from "../src/index.js";

async function createHomeFixture(): Promise<string> {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-api-home-"));
   await mkdir(path.join(homeRoot, ".aiman", "agents"), { recursive: true });
   await mkdir(path.join(homeRoot, ".aiman", "runs"), { recursive: true });
   return homeRoot;
}

async function createProjectFixture(): Promise<string> {
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "aiman-api-project-")
   );
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
      `import { mkdir, writeFile } from "node:fs/promises";
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

if (lastMessagePath.length > 0) {
   await mkdir(path.dirname(lastMessagePath), { recursive: true });
   await writeFile(lastMessagePath, "API result\\n", "utf8");
}

if (useJsonOutput) {
   process.stdout.write(
      JSON.stringify({
         id: "evt-1",
         message: { role: "assistant", content: "API result" },
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

test("createAiman exposes a runnable package API", async () => {
   const originalHome = process.env.HOME;
   const originalUserProfile = process.env.USERPROFILE;
   const originalPath = process.env.PATH;

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
`,
      "utf8"
   );

   process.env.HOME = homeRoot;
   process.env.USERPROFILE = homeRoot;
   process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

   try {
      const aiman = await createAiman({ projectRoot });
      const agents = await aiman.agents.list();

      const result = await aiman.runs.run("reviewer", {
         agentScope: "project",
         task: "Audit the repo"
      });
      const run = await aiman.runs.get(result.runId);

      expect(agents.some((entry) => entry.name === "reviewer")).toBe(true);
      expect(result.status).toBe("success");
      expect(result.finalText).toBe("API result");
      expect("finalText" in run ? run.finalText : "").toBe("API result");
   } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      process.env.PATH = originalPath;
   }
});
