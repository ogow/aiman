import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { runAgent } from "../src/lib/runs.js";

async function createProjectFixture(executableBody: string): Promise<{
   binDir: string;
   projectRoot: string;
}> {
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-runs-"));
   const binDir = path.join(projectRoot, "bin");

   await mkdir(binDir, { recursive: true });
   await mkdir(path.join(projectRoot, ".aiman", "agents"), { recursive: true });
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

function useProjectFixture(projectRoot: string, binDir: string): () => void {
   const originalCwd = process.cwd();
   const originalPath = process.env.PATH;

   process.chdir(projectRoot);
   process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

   return () => {
      process.chdir(originalCwd);

      if (originalPath === undefined) {
         delete process.env.PATH;
      } else {
         process.env.PATH = originalPath;
      }
   };
}

function mockFixedDate(isoString: string): () => void {
   const RealDate = Date;
   const fixedDate = new RealDate(isoString);

   class MockDate extends RealDate {
      constructor(value?: string | number | Date) {
         super(value ?? fixedDate.toISOString());
      }

      static override now(): number {
         return fixedDate.getTime();
      }

      static override parse(value: string): number {
         return RealDate.parse(value);
      }

      static override UTC(
         year: number,
         monthIndex: number,
         date?: number,
         hours?: number,
         minutes?: number,
         seconds?: number,
         ms?: number
      ): number {
         return RealDate.UTC(
            year,
            monthIndex,
            date,
            hours,
            minutes,
            seconds,
            ms
         );
      }
   }

   globalThis.Date = MockDate as typeof Date;

   return () => {
      globalThis.Date = RealDate;
   };
}

test("runAgent uses unique run ids for same-second invocations", async (t) => {
   const fixture = await createProjectFixture(
      `#!/bin/sh
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const restoreDate = mockFixedDate("2026-03-28T12:00:00.000Z");

   t.after(() => {
      restoreDate();
      restoreProject();
   });

   const first = await runAgent({
      agentName: "reviewer",
      mode: "read-only",
      task: "Review the first diff"
   });
   const second = await runAgent({
      agentName: "reviewer",
      mode: "read-only",
      task: "Review the second diff"
   });

   const runIds = await readdir(
      path.join(fixture.projectRoot, ".aiman", "runs")
   );

   assert.notEqual(first.runId, second.runId);
   assert.equal(runIds.length, 2);
});

test("runAgent persists an error record when the provider cannot spawn", async () => {
   const fixture = await createProjectFixture(
      `#!/bin/sh
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );

   try {
      const result = await runAgent({
         agentName: "reviewer",
         cwd: "missing/subdir",
         mode: "read-only",
         task: "Review the diff"
      });
      const [runId] = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs")
      );

      assert.ok(runId);

      const runFilePath = path.join(
         fixture.projectRoot,
         ".aiman",
         "runs",
         runId,
         "run.md"
      );
      const persistedRun = await readFile(runFilePath, "utf8");

      assert.equal(result.status, "error");
      assert.match(result.errorMessage ?? "", /spawn .*ENOENT|ENOENT/);
      assert.match(persistedRun, /status: error/);
      assert.match(persistedRun, new RegExp(`runId: ${runId}`));
      assert.match(
         persistedRun,
         new RegExp(
            `errorMessage: ${String(result.errorMessage).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
         )
      );
   } finally {
      restoreProject();
   }
});

test("runAgent escalates timed out stubborn providers", async () => {
   const fixture = await createProjectFixture(
      `#!/bin/sh
trap '' TERM
while true
do
  sleep 1
done
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );

   try {
      const result = await runAgent({
         agentName: "reviewer",
         killGraceMs: 25,
         mode: "read-only",
         task: "Review the diff",
         timeoutMs: 50
      });
      const [runId] = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs")
      );

      assert.ok(runId);

      const resultFilePath = path.join(
         fixture.projectRoot,
         ".aiman",
         "runs",
         runId,
         "run.md"
      );
      const persistedRun = await readFile(resultFilePath, "utf8");

      assert.equal(result.status, "error");
      assert.equal(result.errorMessage, "Execution timed out.");
      assert.match(persistedRun, /status: error/);
      assert.match(persistedRun, /errorMessage: Execution timed out\./);
   } finally {
      restoreProject();
   }
});

test("runAgent reports the structured run path when a run file is written", async () => {
   const fixture = await createProjectFixture(
      `#!/bin/sh
cat > "$AIMAN_RUN_PATH" <<'EOF'
---
kind: playwright-exploration
summary: Explored checkout flow
artifacts:
  - kind: screenshot
    label: checkout screenshot
    path: checkout.png
findings:
  - title: Checkout button is visible
    severity: info
    detail: Button remains visible after cart load
---
# Checkout Exploration

Body details.
EOF
mkdir -p "$AIMAN_ARTIFACTS_DIR"
printf 'png-data' > "$AIMAN_ARTIFACTS_DIR/checkout.png"
echo 'Primary answer'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );

   try {
      const result = await runAgent({
         agentName: "reviewer",
         mode: "read-only",
         task: "Review the diff"
      });
      const [runId] = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs")
      );
      assert.ok(runId);

      assert.equal(result.status, "success");
      assert.equal(result.finalText, "Primary answer");
      const runPath = result.runPath ?? "";
      assert.notEqual(runPath, "");
      assert.match(runPath, new RegExp(`${runId}/run\\.md$`));

      const persistedRun = await readFile(
         path.join(fixture.projectRoot, ".aiman", "runs", runId, "run.md"),
         "utf8"
      );

      assert.match(persistedRun, /kind: playwright-exploration/);
      assert.match(persistedRun, /summary: Explored checkout flow/);
      assert.match(persistedRun, /artifactsDir:/);
      assert.match(persistedRun, /promptPath:/);
      assert.match(persistedRun, /# Checkout Exploration/);

      const runFiles = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs", runId)
      );

      assert.equal(runFiles.includes("report.md"), false);
      assert.equal(runFiles.includes("result.json"), false);
      assert.equal(runFiles.includes("run.json"), false);
      assert.equal(runFiles.includes("stderr.log"), false);
   } finally {
      restoreProject();
   }
});
