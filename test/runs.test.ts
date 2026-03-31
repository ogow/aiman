import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
   launchRun,
   listRuns,
   readRunDetails,
   runAgent,
   runDetachedWorker
} from "../src/lib/runs.js";

async function createProjectFixture(executableBody: string): Promise<{
   binDir: string;
   projectRoot: string;
}> {
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-runs-"));
   const binDir = path.join(projectRoot, "bin");

   await mkdir(binDir, { recursive: true });
   await mkdir(path.join(projectRoot, ".aiman", "agents"), { recursive: true });
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
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   return { binDir, projectRoot };
}

async function createUserHomeFixture(): Promise<string> {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-"));
   await mkdir(path.join(homeRoot, ".aiman", "agents"), { recursive: true });
   await mkdir(path.join(homeRoot, ".agents", "skills"), { recursive: true });
   return homeRoot;
}

function useProjectFixture(
   projectRoot: string,
   binDir: string,
   homeRoot?: string
): () => void {
   const originalCwd = process.cwd();
   const originalHome = process.env.HOME;
   const originalPath = process.env.PATH;

   process.chdir(projectRoot);
   if (homeRoot !== undefined) {
      process.env.HOME = homeRoot;
   }
   process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

   return () => {
      process.chdir(originalCwd);

      if (originalHome === undefined) {
         delete process.env.HOME;
      } else {
         process.env.HOME = originalHome;
      }

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

function renderLaunchFrontmatter(input: {
   agentPath: string;
   cwd: string;
   launchMode: "detached" | "foreground";
   mode: "read-only" | "workspace-write";
   model?: string;
   reasoningEffort?: "high" | "low" | "medium";
   runId?: string;
}): string {
   const lastMessagePath =
      typeof input.runId === "string"
         ? path.join(
              input.cwd,
              ".aiman",
              "runs",
              input.runId,
              ".codex-last-message.txt"
           )
         : "/tmp/.codex-last-message.txt";

   return [
      "launch:",
      "  agentDigest: test-agent-digest",
      "  agentName: reviewer",
      `  agentPath: ${input.agentPath}`,
      "  agentScope: project",
      "  args:",
      "    - exec",
      "    - --sandbox",
      `    - ${input.mode}`,
      "    - -a",
      "    - never",
      "    - --cd",
      `    - ${input.cwd}`,
      "    - --output-last-message",
      `    - ${lastMessagePath}`,
      "    - '-'",
      "  command: codex",
      `  cwd: ${input.cwd}`,
      "  envKeys:",
      "    - AIMAN_ARTIFACTS_DIR",
      "    - AIMAN_RUN_DIR",
      "    - AIMAN_RUN_ID",
      "    - AIMAN_RUN_PATH",
      "    - PATH",
      "  killGraceMs: 1000",
      `  launchMode: ${input.launchMode}`,
      ...(typeof input.model === "string" ? [`  model: ${input.model}`] : []),
      `  mode: ${input.mode}`,
      "  permissions: read-only",
      "  promptDigest: test-prompt-digest",
      "  promptTransport: stdin",
      "  provider: codex",
      "  skills: []",
      ...(typeof input.reasoningEffort === "string"
         ? [`  reasoningEffort: ${input.reasoningEffort}`]
         : []),
      "  timeoutMs: 300000"
   ].join("\n");
}

test("runAgent uses unique run ids for same-second invocations", async (t) => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
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
   assert.equal(first.agentScope, "project");
   assert.equal(first.launchMode, "foreground");
   assert.match(first.agentPath ?? "", /reviewer\.md$/);
   assert.equal(runIds.length, 2);
});

test("runAgent persists an error record when the provider cannot spawn", async () => {
   const fixture = await createProjectFixture(
      `
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
      assert.equal(result.agentScope, "project");
      assert.equal(result.launchMode, "foreground");
      assert.match(result.agentPath ?? "", /reviewer\.md$/);
      assert.match(result.errorMessage ?? "", /spawn .*ENOENT|ENOENT/);
      assert.match(persistedRun, /status: error/);
      assert.match(persistedRun, /launchMode: foreground/);
      assert.match(persistedRun, /agentScope: project/);
      assert.match(persistedRun, /agentPath:[\s\S]*reviewer\.md/);
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
      assert.equal(result.launchMode, "foreground");
      assert.equal(result.agentScope, "project");
      assert.equal(result.errorMessage, "Execution timed out.");
      assert.match(persistedRun, /status: error/);
      assert.match(persistedRun, /launchMode: foreground/);
      assert.match(persistedRun, /agentScope: project/);
      assert.match(persistedRun, /errorMessage: Execution timed out\./);
   } finally {
      restoreProject();
   }
});

test("runAgent fails fast when a required MCP is missing", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'unexpected'
echo 'unexpected'
`
   );

   await writeFile(
      path.join(fixture.binDir, "codex"),
      `#!/bin/sh
if [ "$1" = "mcp" ] && [ "$2" = "list" ]
then
  cat <<'EOF'
[
  {
    "name": "chrome-devtools",
    "enabled": true,
    "disabled_reason": null,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    },
    "auth_status": "unsupported"
  }
]
EOF
  exit 0
fi
exit 99
`,
      {
         encoding: "utf8",
         mode: 0o755
      }
   );
   await writeFile(
      path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
      `---
name: reviewer
provider: codex
description: Reviews code for risks
permissions: read-only
requiredMcps:
  - github
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );

   try {
      await assert.rejects(
         runAgent({
            agentName: "reviewer",
            mode: "read-only",
            task: "Review the diff"
         }),
         /requires MCP "github".*did not list it in "codex mcp list --json"/
      );

      const runDirs = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs")
      );

      assert.deepEqual(runDirs, []);
   } finally {
      restoreProject();
   }
});

test("runAgent reports the structured run path when a run file is written", async () => {
   const fixture = await createProjectFixture(
      `
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
write_last_message 'Primary answer'
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
      assert.equal(result.agentScope, "project");
      assert.equal(result.launchMode, "foreground");
      assert.match(result.agentPath ?? "", /reviewer\.md$/);
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
      assert.match(persistedRun, /launchMode: foreground/);
      assert.match(persistedRun, /agentScope: project/);
      assert.match(persistedRun, /agentPath:[\s\S]*reviewer\.md/);
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

test("runAgent persists frozen launch evidence without storing env values", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const originalApiKey = process.env.OPENAI_API_KEY;
   process.env.OPENAI_API_KEY = "top-secret-test-key";

   try {
      const result = await runAgent({
         agentName: "reviewer",
         mode: "read-only",
         task: "Review the diff"
      });
      const run = await readRunDetails(result.runId);
      const persistedRun = await readFile(run.paths.runFile, "utf8");

      assert.equal(run.launch.command, "codex");
      assert.equal(run.launch.promptTransport, "stdin");
      assert.match(run.launch.agentDigest, /^[a-f0-9]{64}$/);
      assert.match(run.launch.promptDigest, /^[a-f0-9]{64}$/);
      assert.ok(run.launch.envKeys.includes("OPENAI_API_KEY"));
      assert.match(persistedRun, /launch:/);
      assert.match(persistedRun, /OPENAI_API_KEY/);
      assert.doesNotMatch(persistedRun, /top-secret-test-key/);
   } finally {
      restoreProject();

      if (originalApiKey === undefined) {
         delete process.env.OPENAI_API_KEY;
      } else {
         process.env.OPENAI_API_KEY = originalApiKey;
      }
   }
});

test("runAgent resolves declared skills and freezes the project winner in launch metadata", async () => {
   const fixture = await createProjectFixture(
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
skills:
  - repo-search
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir,
      homeRoot
   );

   try {
      const result = await runAgent({
         agentName: "reviewer",
         mode: "read-only",
         task: "Review the diff"
      });
      const run = await readRunDetails(result.runId);

      assert.deepEqual(
         run.launch.skills.map((skill) => skill.name),
         ["repo-search"]
      );
      assert.equal(run.launch.skills[0]?.scope, "project");
      assert.match(
         run.launch.skills[0]?.path ?? "",
         /\/\.agents\/skills\/repo-search\/SKILL\.md$/
      );
      assert.match(run.launch.skills[0]?.digest ?? "", /^[a-f0-9]{64}$/);
   } finally {
      restoreProject();
   }
});

test("runAgent can resolve a user-scope agent explicitly", async () => {
   const fixture = await createProjectFixture(
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
description: Reviews code for risks
permissions: read-only
---

Task: {{task}}

Review the current change carefully.
`,
      "utf8"
   );

   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir,
      homeRoot
   );

   try {
      const result = await runAgent({
         agentName: "reviewer",
         agentScope: "user",
         mode: "read-only",
         task: "Review the diff"
      });

      assert.equal(result.status, "success");
      assert.equal(result.agentScope, "user");
      assert.equal(result.launchMode, "foreground");
      assert.match(result.agentPath ?? "", /\/\.aiman\/agents\/reviewer\.md$/);
   } finally {
      restoreProject();
   }
});

test("launchRun persists a terminal error when the detached worker cannot spawn", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );

   try {
      await assert.rejects(
         launchRun({
            agentName: "reviewer",
            cwd: "does-not-exist",
            mode: "read-only",
            task: "Review the diff"
         }),
         /could not be launched/
      );

      const runDirs = await readdir(
         path.join(fixture.projectRoot, ".aiman", "runs")
      );

      assert.equal(runDirs.length, 1);

      const persistedRun = await readFile(
         path.join(
            fixture.projectRoot,
            ".aiman",
            "runs",
            runDirs[0]!,
            "run.md"
         ),
         "utf8"
      );

      assert.match(persistedRun, /status: error/);
      assert.doesNotMatch(persistedRun, /status: running/);
   } finally {
      restoreProject();
   }
});

test("readRunDetails derives live state from the stored pid", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const restoreDate = mockFixedDate("2026-03-30T19:10:06.000Z");
   const liveRunId = "20260330T191000Z-live-reviewer";
   const staleRunId = "20260330T190500Z-stale-reviewer";

   try {
      const liveRunDir = path.join(
         fixture.projectRoot,
         ".aiman",
         "runs",
         liveRunId
      );
      const staleRunDir = path.join(
         fixture.projectRoot,
         ".aiman",
         "runs",
         staleRunId
      );

      await mkdir(liveRunDir, { recursive: true });
      await mkdir(staleRunDir, { recursive: true });
      await writeFile(
         path.join(liveRunDir, "run.md"),
         `---
runId: ${liveRunId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${fixture.projectRoot}
startedAt: 2026-03-30T19:10:00.000Z
pid: ${process.pid}
heartbeatAt: 2026-03-30T19:10:05.000Z
${renderLaunchFrontmatter({
   agentPath: path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: fixture.projectRoot,
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
agentPath: ${path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: detached
mode: read-only
cwd: ${fixture.projectRoot}
startedAt: 2026-03-30T19:05:00.000Z
pid: 999999
heartbeatAt: 2026-03-30T19:05:01.000Z
${renderLaunchFrontmatter({
   agentPath: path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: fixture.projectRoot,
   launchMode: "detached",
   mode: "read-only"
})}
---
`,
         "utf8"
      );

      const liveRun = await readRunDetails(liveRunId);
      const staleRun = await readRunDetails(staleRunId);
      const activeRuns = await listRuns({ filter: "active" });
      const historicRuns = await listRuns({ filter: "historic" });
      const allRuns = await listRuns({ filter: "all" });

      assert.equal(liveRun.active, true);
      assert.equal(liveRun.launchMode, "foreground");
      assert.equal(staleRun.active, false);
      assert.equal(staleRun.launchMode, "detached");
      assert.equal(
         staleRun.warning,
         "Process exited before terminal record was written."
      );
      assert.deepEqual(
         activeRuns.map((run) => run.runId),
         [liveRunId]
      );
      assert.deepEqual(
         historicRuns.map((run) => run.runId),
         [staleRunId]
      );
      assert.deepEqual(
         allRuns.map((run) => run.runId),
         [liveRunId, staleRunId]
      );
   } finally {
      restoreDate();
      restoreProject();
   }
});

test("readRunDetails requires a fresh heartbeat for running sessions", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const restoreDate = mockFixedDate("2026-03-30T19:15:20.000Z");
   const runId = "20260330T191500Z-stale-heartbeat-reviewer";

   try {
      const runDir = path.join(fixture.projectRoot, ".aiman", "runs", runId);

      await mkdir(runDir, { recursive: true });
      await writeFile(
         path.join(runDir, "run.md"),
         `---
runId: ${runId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${fixture.projectRoot}
startedAt: 2026-03-30T19:15:00.000Z
pid: ${process.pid}
heartbeatAt: 2026-03-30T19:15:00.000Z
${renderLaunchFrontmatter({
   agentPath: path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: fixture.projectRoot,
   launchMode: "foreground",
   mode: "read-only"
})}
---
`,
         "utf8"
      );

      const run = await readRunDetails(runId);

      assert.equal(run.active, false);
      assert.equal(
         run.warning,
         "Process exited before terminal record was written."
      );
   } finally {
      restoreDate();
      restoreProject();
   }
});

test("runDetachedWorker uses the snapshotted launch settings", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'detached ok'
echo 'detached ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const runId = "20260330T193000Z-reviewer";

   try {
      const runDir = path.join(fixture.projectRoot, ".aiman", "runs", runId);

      await mkdir(runDir, { recursive: true });
      await writeFile(
         path.join(runDir, "prompt.md"),
         "Task: Review the diff\n\nReview the current change carefully.\n",
         "utf8"
      );
      await writeFile(
         path.join(runDir, "run.md"),
         `---
runId: ${runId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: detached
model: gpt-5.4
reasoningEffort: medium
mode: read-only
cwd: ${fixture.projectRoot}
startedAt: 2026-03-30T19:30:00.000Z
${renderLaunchFrontmatter({
   agentPath: path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
   cwd: fixture.projectRoot,
   launchMode: "detached",
   mode: "read-only",
   model: "gpt-5.4",
   reasoningEffort: "medium",
   runId
})}
---
`,
         "utf8"
      );
      await writeFile(
         path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md"),
         `---
name: reviewer
provider: gemini
description: Drifted provider
permissions: read-only
model: gemini-2.5-pro
---

Task: {{task}}

This file changed after launch.
`,
         "utf8"
      );

      const result = await runDetachedWorker(runId);
      const persistedRun = await readFile(path.join(runDir, "run.md"), "utf8");

      assert.equal(result.status, "success");
      assert.equal(result.finalText, "detached ok");
      assert.equal(result.launchMode, "detached");
      assert.match(persistedRun, /provider: codex/);
      assert.match(persistedRun, /model: gpt-5.4/);
      assert.match(persistedRun, /reasoningEffort: medium/);
      assert.match(persistedRun, /status: success/);
   } finally {
      restoreProject();
   }
});

test("readRunDetails fails clearly when launch evidence is missing", async () => {
   const fixture = await createProjectFixture(
      `
write_last_message 'ok'
echo 'ok'
`
   );
   const restoreProject = useProjectFixture(
      fixture.projectRoot,
      fixture.binDir
   );
   const runId = "20260330T194000Z-broken-reviewer";
   const runDir = path.join(fixture.projectRoot, ".aiman", "runs", runId);

   try {
      await mkdir(runDir, { recursive: true });
      await writeFile(
         path.join(runDir, "run.md"),
         `---
runId: ${runId}
status: running
agent: reviewer
agentScope: project
agentPath: ${path.join(fixture.projectRoot, ".aiman", "agents", "reviewer.md")}
provider: codex
launchMode: foreground
mode: read-only
cwd: ${fixture.projectRoot}
startedAt: 2026-03-30T19:40:00.000Z
---
`,
         "utf8"
      );

      await assert.rejects(readRunDetails(runId), /missing required fields/);
   } finally {
      restoreProject();
   }
});
