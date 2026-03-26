import test from "node:test";
import assert from "node:assert/strict";

import {
   ModelNotFoundError,
   ReasoningEffortNotSupportedError,
   ValidationError,
   RunnerNotFoundError
} from "../src/lib/errors.js";
import {
   buildRunPlan,
   resolveProviderRunner
} from "../src/lib/providers/index.js";

test("buildRunPlan uses codex defaults when reasoningEffort is configured", () => {
   const plan = buildRunPlan({
      agent: {
         provider: "codex"
      },
      model: "gpt-5.4",
      reasoningEffort: "high",
      workspace: "/tmp/project",
      assembledPrompt: "Ship the fix."
   });

   assert.equal(plan.command, "codex");
   assert.deepEqual(plan.args, [
      "exec",
      "--model",
      "gpt-5.4",
      "--config",
      'model_reasoning_effort="high"',
      "Ship the fix."
   ]);
});

test("buildRunPlan uses the built-in test provider defaults", () => {
   const plan = buildRunPlan({
      agent: {
         provider: "test"
      },
      model: "test-model",
      reasoningEffort: "low",
      workspace: "/tmp/project",
      assembledPrompt: "Run checks."
   });

   assert.equal(plan.command, "node");
   const [flag, script, prompt] = plan.args;

   assert.equal(flag, "-e");
   assert.ok(script);
   assert.match(script, /AGENT_MODEL/);
   assert.match(script, /AGENT_REASONING_EFFORT/);
   assert.equal(prompt, "Run checks.");
});

test("buildRunPlan rejects unsupported provider models", () => {
   assert.throws(() => {
      buildRunPlan({
         agent: {
            provider: "gemini"
         },
         model: "gemini-unknown",
         reasoningEffort: "",
         workspace: "/tmp/project",
         assembledPrompt: "Summarize the repo."
      });
   }, ModelNotFoundError);
});

test("buildRunPlan rejects reasoningEffort for unsupported providers", () => {
   assert.throws(() => {
      buildRunPlan({
         agent: {
            provider: "gemini"
         },
         model: "gemini-2.5-pro",
         reasoningEffort: "high",
         workspace: "/tmp/project",
         assembledPrompt: "Summarize the repo."
      });
   }, ReasoningEffortNotSupportedError);
});

test("buildRunPlan rejects reasoningEffort values unsupported by the selected model", () => {
   assert.throws(
      () => {
         buildRunPlan({
            agent: {
               provider: "codex"
            },
            model: "gpt-5",
            reasoningEffort: "xhigh",
            workspace: "/tmp/project",
            assembledPrompt: "Ship the fix."
         });
      },
      (error) => {
         assert.ok(error instanceof ValidationError);
         assert.match(error.message, /gpt-5/);
         return true;
      }
   );

   assert.throws(
      () => {
         buildRunPlan({
            agent: {
               provider: "codex"
            },
            model: "gpt-5.1-codex-mini",
            reasoningEffort: "low",
            workspace: "/tmp/project",
            assembledPrompt: "Ship the fix."
         });
      },
      (error) => {
         assert.ok(error instanceof ValidationError);
         assert.match(error.message, /gpt-5\.1-codex-mini/);
         return true;
      }
   );
});

test("resolveProviderRunner rejects unknown providers", () => {
   assert.throws(() => {
      resolveProviderRunner("unknown");
   }, RunnerNotFoundError);
});
