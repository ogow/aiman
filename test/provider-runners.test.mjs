import test from "node:test";
import assert from "node:assert/strict";

import { ModelNotFoundError, RunnerNotFoundError } from "../src/lib/errors.mjs";
import { buildRunPlan, resolveProviderRunner } from "../src/lib/providers/index.mjs";

test("buildRunPlan uses codex defaults when no explicit command is configured", () => {
  const plan = buildRunPlan({
    agent: {
      provider: "codex"
    },
    model: "gpt-5",
    workspace: "/tmp/project",
    assembledPrompt: "Ship the fix."
  });

  assert.equal(plan.command, "codex");
  assert.deepEqual(plan.args, ["exec", "--model", "gpt-5", "Ship the fix."]);
});

test("buildRunPlan uses the built-in test provider defaults", () => {
  const plan = buildRunPlan({
    agent: {
      provider: "test"
    },
    model: "test-model",
    workspace: "/tmp/project",
    assembledPrompt: "Run checks."
  });

  assert.equal(plan.command, "node");
  assert.equal(plan.args[0], "-e");
  assert.match(plan.args[1], /AGENT_MODEL/);
  assert.equal(plan.args[2], "Run checks.");
});

test("buildRunPlan rejects unsupported provider models", () => {
  assert.throws(() => {
    buildRunPlan({
      agent: {
        provider: "gemini"
      },
      model: "gemini-unknown",
      workspace: "/tmp/project",
      assembledPrompt: "Summarize the repo."
    });
  }, ModelNotFoundError);
});

test("resolveProviderRunner rejects unknown providers", () => {
  assert.throws(() => {
    resolveProviderRunner("unknown");
  }, RunnerNotFoundError);
});
