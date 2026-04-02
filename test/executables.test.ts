import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
   resolveCommandLaunch,
   resolveExecutable
} from "../src/lib/executables.js";

async function createExecutableFixture(input: {
   fileName: string;
   mode?: number;
}): Promise<string> {
   const binDir = await mkdtemp(path.join(os.tmpdir(), "aiman-exec-"));
   const filePath = path.join(binDir, input.fileName);

   await mkdir(binDir, { recursive: true });
   await writeFile(filePath, "echo test\n", {
      encoding: "utf8",
      mode: input.mode ?? 0o755
   });

   return binDir;
}

test("resolveExecutable finds a Windows PATHEXT shim on PATH", async () => {
   const binDir = await createExecutableFixture({
      fileName: "codex.cmd",
      mode: 0o644
   });

   const resolved = await resolveExecutable("codex", {
      pathExtValue: ".COM;.EXE;.BAT;.CMD",
      pathValue: binDir,
      platform: "win32"
   });

   assert.equal(resolved, path.join(binDir, "codex.cmd"));
});

test("resolveCommandLaunch uses the shell for a Windows .cmd shim", async () => {
   const binDir = await createExecutableFixture({
      fileName: "gemini.cmd",
      mode: 0o644
   });
   const comspecPath = "C:\\Windows\\System32\\cmd.exe";

   const launch = await resolveCommandLaunch("gemini", ["--help"], {
      comspecValue: comspecPath,
      pathExtValue: ".CMD",
      pathValue: binDir,
      platform: "win32"
   });

   assert.equal(launch.command, comspecPath);
   assert.deepEqual(launch.args.slice(0, 3), ["/d", "/s", "/c"]);
   assert.match(launch.args[3] ?? "", /gemini\.cmd/i);
   assert.match(launch.args[3] ?? "", /--help/);
   assert.equal(launch.needsShell, false);
   assert.equal(launch.windowsVerbatimArguments, true);
});

test("resolveCommandLaunch preserves shell-sensitive args for a Windows .cmd shim", async () => {
   const binDir = await mkdtemp(path.join(os.tmpdir(), "aiman-exec-shell-"));
   const scriptPath = path.join(binDir, "gemini.mjs");
   const outputPath = path.join(binDir, "captured-args.json");

   await mkdir(binDir, { recursive: true });
   await writeFile(
      scriptPath,
      `import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(outputPath)}, JSON.stringify(process.argv.slice(2)), "utf8");
`,
      "utf8"
   );
   await writeFile(
      path.join(binDir, "gemini.cmd"),
      `@echo off\r
"${process.execPath}" "%~dp0\\gemini.mjs" %*\r
`,
      "utf8"
   );

   const expectedArgs = [
      "--prompt",
      'Investigate %PATH% and "quotes" & pipes | carets ^ today',
      "--approval-mode",
      "plan"
   ];
   const launch = await resolveCommandLaunch("gemini", expectedArgs, {
      pathExtValue: ".CMD",
      pathValue: binDir,
      platform: "win32"
   });

   await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
         stdio: ["ignore", "pipe", "pipe"],
         windowsVerbatimArguments: launch.windowsVerbatimArguments
      });
      let stderr = "";

      child.stderr?.on("data", (chunk: Buffer | string) => {
         stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => {
         if (code === 0) {
            resolve();
            return;
         }

         reject(
            new Error(
               `Expected Windows shim launch to succeed, received ${code}: ${stderr}`
            )
         );
      });
   });

   assert.deepEqual(
      JSON.parse(await readFile(outputPath, "utf8")) as string[],
      expectedArgs
   );
});

test("resolveExecutable prefers a Windows .cmd shim over a bare shim file", async () => {
   const binDir = await mkdtemp(path.join(os.tmpdir(), "aiman-exec-pref-"));

   await mkdir(binDir, { recursive: true });
   await writeFile(path.join(binDir, "codex"), "non-runnable shim\n", "utf8");
   await writeFile(path.join(binDir, "codex.cmd"), "@echo off\r\n", "utf8");

   const resolved = await resolveExecutable("codex", {
      pathExtValue: ".CMD",
      pathValue: binDir,
      platform: "win32"
   });

   assert.equal(resolved, path.join(binDir, "codex.cmd"));
});

test("resolveCommandLaunch keeps a Unix executable shell-free", async () => {
   const binDir = await createExecutableFixture({
      fileName: "codex"
   });

   const launch = await resolveCommandLaunch("codex", ["--version"], {
      pathValue: binDir,
      platform: "linux"
   });

   assert.equal(launch.command, path.join(binDir, "codex"));
   assert.deepEqual(launch.args, ["--version"]);
   assert.equal(launch.needsShell, false);
   assert.equal(launch.windowsVerbatimArguments, false);
});
