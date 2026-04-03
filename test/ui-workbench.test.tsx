import { afterEach, describe, expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { getProjectPaths } from "../src/lib/paths.js";
import type {
  ProjectContext,
  RunInspection,
  ScopedProfileDefinition
} from "../src/lib/types.js";
import { AimanWorkbench, type WorkbenchServices } from "../src/ui/aiman-app.js";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

const projectPaths = getProjectPaths(process.cwd());

const sampleProfile: ScopedProfileDefinition = {
  body: "## Role\nYou are the reviewer.\n\n## Task Input\n{{task}}\n",
  description: "Reviews a project task",
  id: "reviewer",
  model: "gpt-5.4-mini",
  mode: "safe",
  name: "reviewer",
  path: "/tmp/reviewer.md",
  provider: "codex",
  reasoningEffort: "medium",
  scope: "project"
};

const sampleContext: ProjectContext = {
  content: "- Keep answers short.",
  path: "AGENTS.md#Aiman Runtime Context",
  title: "## Aiman Runtime Context"
};

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = undefined;
});

function createRun(input?: Record<string, unknown>): RunInspection {
  return {
    active: false,
    cwd: "/tmp/demo",
    document: {
      artifacts: [],
      body: "Run body",
      exists: true,
      frontmatter: {},
      path: "/tmp/demo/run.md"
    },
    durationMs: 1_000,
    endedAt: "2026-04-03T10:01:00.000Z",
    exitCode: 0,
    finalText: "Final answer",
    launch: {
      agentDigest: "agent-digest",
      agentName: "reviewer",
      agentPath: "/tmp/reviewer.md",
      agentScope: "project",
      args: [],
      command: "codex",
      cwd: "/tmp/demo",
      envKeys: [],
      killGraceMs: 1_000,
      launchMode: "foreground",
      mode: "safe",
      model: "gpt-5.4-mini",
      profileDigest: "profile-digest",
      profileName: "reviewer",
      profilePath: "/tmp/reviewer.md",
      profileScope: "project",
      promptDigest: "prompt-digest",
      promptTransport: "stdin",
      provider: "codex",
      reasoningEffort: "medium",
      skills: [],
      task: "Audit the repo",
      timeoutMs: 300_000
    },
    launchMode: "foreground",
    mode: "safe",
    paths: {
      artifactsDir: "/tmp/demo/artifacts",
      promptFile: "/tmp/demo/prompt.md",
      runDir: "/tmp/demo",
      runFile: "/tmp/demo/run.md",
      stopRequestedFile: "/tmp/demo/.stop-requested",
      stderrLog: "/tmp/demo/stderr.log",
      stdoutLog: "/tmp/demo/stdout.log"
    },
    profile: "reviewer",
    profilePath: "/tmp/reviewer.md",
    profileScope: "project",
    projectRoot: "/tmp/demo",
    provider: "codex",
    runId: "run-001",
    signal: null,
    startedAt: "2026-04-03T10:00:00.000Z",
    status: "success",
    ...input
  } as RunInspection;
}

async function renderWorkbench(
  services: Partial<WorkbenchServices>
): Promise<Awaited<ReturnType<typeof testRender>>> {
  testSetup = await testRender(
    <AimanWorkbench projectPaths={projectPaths} services={services} />,
    {
      height: 36,
      width: 120
    }
  );

  await settle();
  return testSetup;
}

async function settle(iterations = 5): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await Bun.sleep(10);
      await testSetup?.renderOnce();
    });
  }
}

async function pressTab(): Promise<void> {
  await act(async () => {
    await testSetup?.mockInput.pressTab();
  });
}

async function pressKey(
  key: string,
  modifiers?: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    super?: boolean;
    hyper?: boolean;
  }
): Promise<void> {
  await act(async () => {
    testSetup?.mockInput.pressKey(key, modifiers);
  });
  await settle(2);
}

async function typeText(text: string): Promise<void> {
  await act(async () => {
    await testSetup?.mockInput.typeText(text);
  });
}

describe("AimanWorkbench", () => {
  test("renders the start workspace by default", async () => {
    const setup = await renderWorkbench({
      async listProfiles() {
        return [sampleProfile];
      },
      async listRuns() {
        return [];
      },
      async loadProjectContext() {
        return sampleContext;
      }
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Start");
    expect(frame).toContain("Welcome to the Aiman Operator Workbench");
  });

  test("launches a task and switches to the runs workspace", async () => {
    let runs: RunInspection[] = [];
    let launchedTask = "";

    const setup = await renderWorkbench({
      async listProfiles() {
        return [sampleProfile];
      },
      async listRuns() {
        return runs;
      },
      async loadProjectContext() {
        return sampleContext;
      },
      async readRunLog() {
        return "prompt body";
      },
      async readRunOutput() {
        return "stdout\nstderr";
      },
      async runAgent(input) {
        launchedTask = input.task;
        input.onRunStarted?.({
          profile: "reviewer",
          profilePath: sampleProfile.path,
          profileScope: sampleProfile.scope,
          provider: sampleProfile.provider,
          runId: "run-001",
          startedAt: "2026-04-03T10:00:00.000Z"
        });
        input.onRunOutput?.({
          stream: "stdout",
          text: "live output\n"
        });
        runs = [createRun()];

        return {
          finalText: "Final answer",
          profile: "reviewer",
          profilePath: sampleProfile.path,
          profileScope: sampleProfile.scope,
          provider: sampleProfile.provider,
          runId: "run-001",
          status: "success"
        };
      }
    });

    // Switch to Tasks workspace (t)
    await pressKey("t");

    // Focus task editor (drill down with Enter)
    await pressKey("enter");

    await typeText("Audit the repo");
    await settle();

    // Launch
    await pressKey("l", { ctrl: true });
    await settle(10);

    const frame = setup.captureCharFrame();

    expect(launchedTask).toBe("Audit the repo");
    expect(frame).toContain("Runs");
    expect(frame).toContain("run-001 finished successfully");
    expect(frame).toContain("Final answer");
  });

  test("requests stop for the selected active run", async () => {
    let stopRequested = false;

    const setup = await renderWorkbench({
      async listProfiles() {
        return [sampleProfile];
      },
      async listRuns() {
        return [
          createRun({
            active: true,
            durationMs: undefined,
            endedAt: undefined,
            finalText: "",
            runId: "run-active",
            status: "running"
          })
        ];
      },
      async loadProjectContext() {
        return sampleContext;
      },
      async readRunLog() {
        return "prompt body";
      },
      async readRunOutput() {
        return "streaming output";
      },
      async stopRun(runId) {
        stopRequested = runId === "run-active";

        return createRun({
          active: false,
          finalText: "",
          runId,
          status: "cancelled"
        });
      }
    });

    // Switch to Runs workspace (r)
    await pressKey("r");

    // Ctrl+S to stop
    await pressKey("s", { ctrl: true });
    await settle(10);

    const frame = setup.captureCharFrame();

    expect(stopRequested).toBe(true);
    expect(frame).toContain("Stop requested for run-active");
  });
});
