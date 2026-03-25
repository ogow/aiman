import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assemblePrompt } from "../src/lib/context.mjs";

test("assemblePrompt prepends AGENTS.md and the agent prompt", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-context-"));

  await writeFile(path.join(workspace, "AGENTS.md"), "Keep it concise.\n");

  const prompt = await assemblePrompt({
    rootDir: workspace,
    workspace,
    agent: {
      systemPrompt: "You are the billing agent."
    },
    taskPrompt: "Investigate invoice retries."
  });

  assert.match(prompt, /Keep it concise/);
  assert.match(prompt, /You are the billing agent/);
  assert.match(prompt, /Investigate invoice retries/);
});
