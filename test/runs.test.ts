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
echo '{"message":{"content":[{"text":"ok"}]}}'
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
echo '{"message":{"content":[{"text":"ok"}]}}'
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
         "run.json"
      );
      const resultFilePath = path.join(
         fixture.projectRoot,
         ".aiman",
         "runs",
         runId,
         "result.json"
      );
      const runState = JSON.parse(await readFile(runFilePath, "utf8")) as {
         errorMessage?: string;
         status: string;
      };
      const persistedResult = JSON.parse(
         await readFile(resultFilePath, "utf8")
      ) as {
         errorMessage?: string;
         status: string;
      };

      assert.equal(result.status, "error");
      assert.match(result.errorMessage ?? "", /spawn .*ENOENT|ENOENT/);
      assert.equal(runState.status, "error");
      assert.equal(persistedResult.status, "error");
      assert.equal(persistedResult.errorMessage, result.errorMessage);
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
         "result.json"
      );
      const persistedResult = JSON.parse(
         await readFile(resultFilePath, "utf8")
      ) as {
         errorMessage?: string;
         status: string;
      };

      assert.equal(result.status, "error");
      assert.equal(result.errorMessage, "Execution timed out.");
      assert.equal(persistedResult.status, "error");
      assert.equal(persistedResult.errorMessage, "Execution timed out.");
   } finally {
      restoreProject();
   }
});

test("runAgent reports the structured report path when a report is written", async () => {
   const fixture = await createProjectFixture(
      `#!/bin/sh
cat > "$AIMAN_REPORT_PATH" <<'EOF'
---
kind: playwright-exploration
status: success
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
printf 'png-data' > "$AIMAN_ARTIFACTS_DIR/checkout.png"
echo '{"message":{"content":[{"text":"Primary answer"}]}}'
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
      const reportPath = result.reportPath ?? "";
      assert.notEqual(reportPath, "");
      assert.match(reportPath, new RegExp(`${runId}/report\\.md$`));

      const persistedResult = JSON.parse(
         await readFile(
            path.join(
               fixture.projectRoot,
               ".aiman",
               "runs",
               runId,
               "result.json"
            ),
            "utf8"
         )
      ) as {
         paths: {
            artifactsDir?: string;
            reportFile?: string;
         };
      };

      assert.match(
         persistedResult.paths.artifactsDir ?? "",
         new RegExp(`${runId}/artifacts$`)
      );
      assert.match(
         persistedResult.paths.reportFile ?? "",
         new RegExp(`${runId}/report\\.md$`)
      );
   } finally {
      restoreProject();
   }
});
