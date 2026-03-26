import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AgentRegistry } from "../src/lib/agent-registry.js";
import { RunManager } from "../src/lib/runner.js";
import { RunStore } from "../src/lib/run-store.js";

test("RunManager executes a visible project agent and records logs", async () => {
   const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "agent-runner-"));
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const agentRegistry = new AgentRegistry({ workspaceDir, homeDir });
   await agentRegistry.init();

   await agentRegistry.createAgent(
      {
         name: "echo-agent",
         provider: "test",
         model: "test-model",
         systemPrompt: "Echo the run prompt."
      },
      { scope: "project" }
   );

   const runStore = new RunStore(workspaceDir);
   await runStore.init();

   const runManager = new RunManager({
      rootDir: workspaceDir,
      agentRegistry,
      runStore
   });
   const run = await runManager.spawnRun({
      agentName: "echo-agent",
      taskPrompt: "Hello from the test run.",
      workspace: workspaceDir
   });

   const completedRun = await runManager.waitForRun(run.id, 5000);
   const events = await runStore.readEvents(run.id, 50);
   const stdoutEvents = events.filter(
      (event) => event.type === "stdout"
   ) as Array<{ payload: { text: string } }>;

   assert.equal(completedRun.status, "completed");
   assert.equal(completedRun.exitCode, 0);
   assert.ok(
      stdoutEvents.some((event) => event.payload.text.includes("test-model"))
   );
   assert.ok(
      stdoutEvents.some((event) =>
         event.payload.text.includes("Hello from the test run.")
      )
   );
});

test("RunManager lets a run override the agent reasoningEffort", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-reasoning-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const agentRegistry = new AgentRegistry({ workspaceDir, homeDir });
   await agentRegistry.init();

   await agentRegistry.createAgent(
      {
         name: "planner-agent",
         provider: "test",
         model: "test-model",
         reasoningEffort: "high",
         systemPrompt: "Plan the work."
      },
      { scope: "project" }
   );

   const runStore = new RunStore(workspaceDir);
   await runStore.init();

   const runManager = new RunManager({
      rootDir: workspaceDir,
      agentRegistry,
      runStore
   });
   const run = await runManager.spawnRun({
      agentName: "planner-agent",
      taskPrompt: "Outline the migration.",
      workspace: workspaceDir,
      reasoningEffort: "low"
   });

   const completedRun = await runManager.waitForRun(run.id, 5000);
   const events = await runStore.readEvents(run.id, 50);
   const stdoutEvents = events.filter(
      (event) => event.type === "stdout"
   ) as Array<{ payload: { text: string } }>;

   assert.equal(completedRun.status, "completed");
   assert.equal(completedRun.reasoningEffort, "low");
   assert.ok(stdoutEvents.some((event) => event.payload.text.includes("low")));
});

test("RunManager marks long runs as failed when they exceed timeout", async () => {
   const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "agent-timeout-"));
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const agentRegistry = new AgentRegistry({ workspaceDir, homeDir });
   await agentRegistry.init();

   await agentRegistry.createAgent(
      {
         name: "slow-agent",
         provider: "test",
         model: "test-model",
         systemPrompt: "Simulate a slow run."
      },
      { scope: "project" }
   );

   const runStore = new RunStore(workspaceDir);
   await runStore.init();

   const runManager = new RunManager({
      rootDir: workspaceDir,
      agentRegistry,
      runStore,
      killGraceMs: 50
   });
   const run = await runManager.spawnRun({
      agentName: "slow-agent",
      taskPrompt: "__AIMAN_TEST_SLOW__",
      workspace: workspaceDir,
      timeoutMs: 100
   });

   const failedRun = await runManager.waitForRun(run.id, 5000);
   const events = await runStore.readEvents(run.id, 50);

   assert.equal(failedRun.status, "failed");
   assert.equal(failedRun.exitCode, 124);
   assert.match(failedRun.resultSummary ?? "", /timed out after 100ms/i);
   assert.ok(events.some((event) => event.type === "timeout"));
});

test("RunManager preserves cancelled state after requesting termination", async () => {
   const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "agent-cancel-"));
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const agentRegistry = new AgentRegistry({ workspaceDir, homeDir });
   await agentRegistry.init();

   await agentRegistry.createAgent(
      {
         name: "stubborn-agent",
         provider: "test",
         model: "test-model",
         systemPrompt: "Simulate a stubborn run."
      },
      { scope: "project" }
   );

   const runStore = new RunStore(workspaceDir);
   await runStore.init();

   const runManager = new RunManager({
      rootDir: workspaceDir,
      agentRegistry,
      runStore,
      killGraceMs: 50
   });
   const run = await runManager.spawnRun({
      agentName: "stubborn-agent",
      taskPrompt: "__AIMAN_TEST_STUBBORN__",
      workspace: workspaceDir
   });

   const cancelledRun = await runManager.cancelRun(run.id);
   await new Promise((resolve) => setTimeout(resolve, 600));
   const persistedRun = await runStore.getRun(run.id);
   const events = await runStore.readEvents(run.id, 50);

   assert.equal(cancelledRun.status, "cancelled");
   assert.ok(persistedRun);
   assert.equal(persistedRun.status, "cancelled");
   assert.match(persistedRun.resultSummary ?? "", /cancelled by user/i);
   assert.ok(events.some((event) => event.type === "termination_requested"));
   assert.ok(events.some((event) => event.type === "closed"));
});
