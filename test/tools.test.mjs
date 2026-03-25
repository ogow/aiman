import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AgentRegistry } from "../src/lib/agent-registry.mjs";
import { RunManager } from "../src/lib/runner.mjs";
import { RunStore } from "../src/lib/run-store.mjs";
import { createToolHandler } from "../src/lib/tools.mjs";

test("run_spawn returns a formatted error when a model is not supported", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "agent-tools-"));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
  const agentRegistry = new AgentRegistry({ workspaceDir, homeDir });
  await agentRegistry.init();

  await agentRegistry.createAgent({
    name: "codex-agent",
    provider: "codex",
    model: "gpt-5",
    systemPrompt: "Review the change."
  }, { scope: "project" });

  const runStore = new RunStore(workspaceDir);
  await runStore.init();

  const runManager = new RunManager({ rootDir: workspaceDir, agentRegistry, runStore });
  const handleToolCall = createToolHandler({
    rootDir: workspaceDir,
    agentRegistry,
    runStore,
    runManager
  });
  const result = await handleToolCall("run_spawn", {
    agentName: "codex-agent",
    taskPrompt: "Do work",
    timeoutMs: 5000,
    model: "gpt-unknown"
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Model not found/);
  assert.match(result.content[0].text, /\u001b\[31m/);
  assert.equal(result.structuredContent.error.code, "model_not_found");
});
