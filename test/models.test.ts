import test from "node:test";
import assert from "node:assert/strict";

import {
   describeReasoningEffort,
   getKnownModels,
   getReasoningEffortValues,
   normalizeReasoningEffort,
   renderReasoningEffortForCli,
   supportsReasoningEffort
} from "../src/lib/models.js";

test("model capabilities expose provider-specific reasoningEffort values", () => {
   assert.deepEqual(getReasoningEffortValues("codex", "gpt-5.4"), [
      "low",
      "medium",
      "high",
      "xhigh"
   ]);
   assert.deepEqual(getReasoningEffortValues("codex", "gpt-5.1-codex-mini"), [
      "medium",
      "high"
   ]);
   assert.deepEqual(getReasoningEffortValues("codex", "gpt-5"), [
      "minimal",
      "low",
      "medium",
      "high"
   ]);
   assert.deepEqual(getReasoningEffortValues("test"), [
      "low",
      "medium",
      "high"
   ]);
   assert.equal(supportsReasoningEffort("claude"), false);
});

test("model capabilities expose the current Codex model catalog", () => {
   const models = getKnownModels("codex");

   assert.ok(models.includes("gpt-5.4"));
   assert.ok(models.includes("gpt-5.4-mini"));
   assert.ok(models.includes("gpt-5.3-codex-spark"));
   assert.ok(models.includes("gpt-5.1-codex-mini"));
   assert.ok(!models.includes("gpt-5-mini"));
});

test("model capabilities normalize aliases and render provider-specific CLI values", () => {
   assert.equal(normalizeReasoningEffort("codex", "gpt-5.4", "MAX"), "xhigh");
   assert.equal(normalizeReasoningEffort("codex", "gpt-5", "MAX"), "");
   assert.equal(
      normalizeReasoningEffort("codex", "gpt-5.1-codex-mini", "low"),
      ""
   );
   assert.equal(normalizeReasoningEffort("test", "careful"), "high");
   assert.equal(renderReasoningEffortForCli("test", "careful"), "test-high");
});

test("model capabilities describe provider-specific validation rules", () => {
   assert.match(describeReasoningEffort("codex", "gpt-5.4"), /gpt-5\.4/);
   assert.match(
      describeReasoningEffort("codex", "gpt-5.4"),
      /low, medium, high, xhigh/
   );
   assert.match(
      describeReasoningEffort("codex", "gpt-5.1-codex-mini"),
      /medium, high/
   );
   assert.match(
      describeReasoningEffort("claude"),
      /does not support reasoningEffort/i
   );
});
