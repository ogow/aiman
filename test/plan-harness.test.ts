import { expect, test } from "bun:test";

import {
   buildTaskPrompt,
   classifyReview,
   type HarnessTask,
   parseHarnessPlan,
   shouldReviewTask
} from "../examples/plan-harness.js";

function getTask(tasks: HarnessTask[], index: number): HarnessTask {
   const task = tasks[index];

   if (task === undefined) {
      throw new Error(`Missing task at index ${index}.`);
   }

   return task;
}

test("parseHarnessPlan applies cheap harness defaults", () => {
   const plan = parseHarnessPlan(
      JSON.stringify({
         tasks: [
            {
               goal: "Add focused docs",
               title: "Docs"
            }
         ]
      })
   );

   expect(plan.builderAgent).toBe("build");
   expect(plan.reviewerAgent).toBe("reviewer");
   expect(plan.finalReview).toBe("always");
   expect(plan.maxCheckRetries).toBe(1);
   expect(getTask(plan.tasks, 0)).toMatchObject({
      id: "task-1",
      review: "auto",
      risk: "low"
   });
});

test("parseHarnessPlan rejects shell-like check strings", () => {
   expect(() =>
      parseHarnessPlan(
         JSON.stringify({
            checks: ["bun run typecheck"],
            tasks: [
               {
                  goal: "Add focused docs",
                  title: "Docs"
               }
            ]
         })
      )
   ).toThrow("checks[0] must be an object");
});

test("shouldReviewTask reviews by task risk and verification failure", () => {
   const plan = parseHarnessPlan(
      JSON.stringify({
         tasks: [
            {
               goal: "Touch shared runtime",
               risk: "medium",
               title: "Runtime"
            },
            {
               goal: "Fix typo",
               review: "skip",
               title: "Docs"
            }
         ]
      })
   );

   expect(
      shouldReviewTask({
         checksHadFailure: false,
         task: getTask(plan.tasks, 0)
      })
   ).toBe(true);
   expect(
      shouldReviewTask({
         checksHadFailure: true,
         task: getTask(plan.tasks, 1)
      })
   ).toBe(false);
});

test("classifyReview requires an explicit blocking prefix", () => {
   expect(classifyReview("BLOCKING: none\nNo findings.")).toBe("clear");
   expect(classifyReview("BLOCKING: yes\nFix this.")).toBe("blocking");
   expect(classifyReview("Looks good.")).toBe("unclear");
});

test("buildTaskPrompt carries check failures without losing the task contract", () => {
   const plan = parseHarnessPlan(
      JSON.stringify({
         tasks: [
            {
               acceptance: ["Typecheck passes"],
               goal: "Fix a type error",
               scope: ["src/example.ts"],
               title: "Types"
            }
         ]
      })
   );
   const prompt = buildTaskPrompt({
      checkFailures: [
         {
            args: ["run", "typecheck"],
            command: "bun",
            durationMs: 10,
            exitCode: 2,
            name: "typecheck",
            output: "Type error",
            passed: false,
            timedOut: false
         }
      ],
      task: getTask(plan.tasks, 0)
   });

   expect(prompt).toContain("<task>");
   expect(prompt).toContain("Fix a type error");
   expect(prompt).toContain("<verification_failures>");
   expect(prompt).toContain("Type error");
});
