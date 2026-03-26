import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = path.resolve(process.cwd(), "src", "cli.ts");
const tsxImportPath = import.meta.resolve("tsx");

interface CliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  { cwd, home, input }: { cwd: string; home: string; input?: string }
): CliRunResult {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxImportPath, cliPath, ...args],
    {
      cwd,
      env: {
        ...process.env,
        HOME: home
      },
      input,
      encoding: "utf8"
    }
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function createWorkspace() {
  const workspaceDir = await mkdtemp(
    path.join(os.tmpdir(), "aiman-cli-workspace-")
  );
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "aiman-cli-home-"));
  return {
    workspaceDir,
    homeDir
  };
}

async function waitFor<T>(
  check: () => Promise<T | false>,
  timeoutMs = 5000
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await check();

    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

test("agent list returns JSON output", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();
  const result = runCli(["agent", "list", "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    agents: []
  });
});

test("--help renders the command overview", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();
  const result = runCli(["--help"], {
    cwd: workspaceDir,
    home: homeDir
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /agent list/);
  assert.match(result.stdout, /run spawn/);
});

test("agent create accepts stdin and agent get returns the created agent", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();
  const createResult = runCli(
    [
      "agent",
      "create",
      "--name",
      "reviewer",
      "--provider",
      "codex",
      "--model",
      "gpt-5.4"
    ],
    {
      cwd: workspaceDir,
      home: homeDir,
      input: "Review the current change.\n"
    }
  );

  assert.equal(createResult.status, 0);
  assert.match(createResult.stdout, /Name: reviewer/);

  const getResult = runCli(["agent", "get", "reviewer", "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });

  assert.equal(getResult.status, 0);
  assert.equal(
    JSON.parse(getResult.stdout).agent.systemPrompt,
    "Review the current change."
  );
});

test("agent create rejects conflicting prompt sources", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();
  const result = runCli(
    [
      "agent",
      "create",
      "--name",
      "reviewer",
      "--provider",
      "codex",
      "--prompt",
      "Inline prompt"
    ],
    {
      cwd: workspaceDir,
      home: homeDir,
      input: "Prompt from stdin\n"
    }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly one source/i);
});

test("project agents override home agents with the same name", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();

  const homeCreate = runCli(
    [
      "agent",
      "create",
      "--name",
      "frontend",
      "--provider",
      "codex",
      "--model",
      "gpt-5.4-mini",
      "--scope",
      "home"
    ],
    {
      cwd: workspaceDir,
      home: homeDir,
      input: "Review the shared frontend.\n"
    }
  );
  assert.equal(homeCreate.status, 0);

  const projectCreate = runCli(
    [
      "agent",
      "create",
      "--name",
      "frontend",
      "--provider",
      "codex",
      "--model",
      "gpt-5.4",
      "--scope",
      "project"
    ],
    {
      cwd: workspaceDir,
      home: homeDir,
      input: "Review the project frontend.\n"
    }
  );
  assert.equal(projectCreate.status, 0);

  const getResult = runCli(["agent", "get", "frontend", "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });

  assert.equal(getResult.status, 0);
  const payload = JSON.parse(getResult.stdout) as {
    agent: { source: string; model: string };
  };
  assert.equal(payload.agent.source, "project");
  assert.equal(payload.agent.model, "gpt-5.4");
});

test("run lifecycle commands work across separate CLI invocations", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();
  const taskFile = path.join(workspaceDir, "task.txt");
  await writeFile(taskFile, "Hello from the CLI run.\n", "utf8");

  const createResult = runCli(
    [
      "agent",
      "create",
      "--name",
      "echo-agent",
      "--provider",
      "test",
      "--model",
      "test-model",
      "--prompt",
      "Echo the run prompt."
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(createResult.status, 0);

  const spawnResult = runCli(
    [
      "run",
      "spawn",
      "--agent",
      "echo-agent",
      "--task-file",
      "task.txt",
      "--json"
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(spawnResult.status, 0);

  const spawnedRun = JSON.parse(spawnResult.stdout).run as {
    id: string;
    agentName: string;
  };
  assert.equal(spawnedRun.agentName, "echo-agent");

  const waitResult = runCli(
    ["run", "wait", spawnedRun.id, "--timeout-ms", "5000", "--json"],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(waitResult.status, 0);

  const completedRun = JSON.parse(waitResult.stdout).run;
  assert.equal(completedRun.status, "completed");
  assert.equal(completedRun.exitCode, 0);

  const listResult = runCli(["run", "list", "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });
  assert.equal(listResult.status, 0);
  assert.ok(
    (JSON.parse(listResult.stdout).runs as Array<{ id: string }>).some(
      (run: { id: string }) => run.id === spawnedRun.id
    )
  );

  const getResult = runCli(["run", "get", spawnedRun.id, "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });
  assert.equal(getResult.status, 0);
  assert.equal(JSON.parse(getResult.stdout).run.id, spawnedRun.id);

  const logsResult = runCli(["run", "logs", spawnedRun.id, "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });
  assert.equal(logsResult.status, 0);
  const stdoutEvents = (
    JSON.parse(logsResult.stdout).events as Array<{
      type: string;
      payload: { text: string };
    }>
  ).filter((event: { type: string }) => event.type === "stdout");
  assert.ok(
    stdoutEvents.some((event: { payload: { text: string } }) =>
      event.payload.text.includes("Hello from the CLI run.")
    )
  );
});

test("run cancel stops an in-flight run started by a previous CLI process", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();

  const createResult = runCli(
    [
      "agent",
      "create",
      "--name",
      "stubborn-agent",
      "--provider",
      "test",
      "--model",
      "test-model",
      "--prompt",
      "Simulate a stubborn run."
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(createResult.status, 0);

  const spawnResult = runCli(
    [
      "run",
      "spawn",
      "--agent",
      "stubborn-agent",
      "--task",
      "__AIMAN_TEST_STUBBORN__",
      "--json"
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(spawnResult.status, 0);
  const runId = JSON.parse(spawnResult.stdout).run.id;

  await waitFor(async () => {
    const getResult = runCli(["run", "get", runId, "--json"], {
      cwd: workspaceDir,
      home: homeDir
    });

    if (getResult.status !== 0) {
      return false;
    }

    const run = JSON.parse(getResult.stdout).run;
    return run.status === "running" && typeof run.pid === "number";
  });

  const cancelResult = runCli(["run", "cancel", runId, "--json"], {
    cwd: workspaceDir,
    home: homeDir
  });
  assert.equal(cancelResult.status, 0);
  assert.equal(JSON.parse(cancelResult.stdout).run.status, "cancelled");

  await waitFor(async () => {
    const logsResult = runCli(["run", "logs", runId, "--json"], {
      cwd: workspaceDir,
      home: homeDir
    });
    const events = JSON.parse(logsResult.stdout).events as Array<{
      type: string;
    }>;
    return events.some((event: { type: string }) => event.type === "closed");
  }, 5000);

  const finalRun = JSON.parse(
    runCli(["run", "get", runId, "--json"], {
      cwd: workspaceDir,
      home: homeDir
    }).stdout
  ).run;
  assert.equal(finalRun.status, "cancelled");

  const logEvents = JSON.parse(
    runCli(["run", "logs", runId, "--json"], {
      cwd: workspaceDir,
      home: homeDir
    }).stdout
  ).events as Array<{ type: string }>;
  assert.ok(
    logEvents.some(
      (event: { type: string }) => event.type === "termination_requested"
    )
  );
  assert.ok(
    logEvents.some((event: { type: string }) => event.type === "closed")
  );
});

test("run spawn returns a non-zero exit code for unsupported models", async () => {
  const { workspaceDir, homeDir } = await createWorkspace();

  const createResult = runCli(
    [
      "agent",
      "create",
      "--name",
      "codex-agent",
      "--provider",
      "codex",
      "--model",
      "gpt-5",
      "--prompt",
      "Review the change."
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );
  assert.equal(createResult.status, 0);

  const spawnResult = runCli(
    [
      "run",
      "spawn",
      "--agent",
      "codex-agent",
      "--task",
      "Do work",
      "--model",
      "gpt-unknown",
      "--json"
    ],
    {
      cwd: workspaceDir,
      home: homeDir
    }
  );

  assert.equal(spawnResult.status, 2);
  const payload = JSON.parse(spawnResult.stdout);
  assert.equal(payload.error.code, "model_not_found");
});
