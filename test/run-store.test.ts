import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RunStore } from "../src/lib/run-store.js";

test("RunStore persists workspace-local runs", async () => {
   const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "run-store-"));
   const runStore = new RunStore(workspaceDir);
   await runStore.init();

   const run = await runStore.createRun({
      agentName: "research",
      agentSource: "project",
      provider: "codex",
      model: "gpt-5",
      reasoningEffort: "medium",
      taskPrompt: "Find risks.",
      assembledPrompt: "Task body",
      workspace: workspaceDir,
      timeoutMs: 5000,
      command: "codex",
      args: ["exec", "Task body"]
   });

   const runs = await runStore.listRuns();
   const [storedRun] = runs;

   assert.equal(runs.length, 1);
   assert.ok(storedRun);
   assert.equal(storedRun.agentName, "research");
   assert.equal(run.status, "pending");
   assert.equal(storedRun.reasoningEffort, "medium");
   assert.equal(storedRun.timeoutMs, 5000);
});
