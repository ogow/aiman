# Orchestration Guide

`aiman` is a low-level engine designed to run one agent at a time. It does not have a built-in workflow engine because real-world orchestration is often project-specific. Instead, you should build your flows using TypeScript/JavaScript scripts that consume the `aiman` API.

## Core Concepts

### 1. The Harness
A **Harness** is the environment wrapper you put around an agent run. It handles:
- **Context Injection**: Discovering and providing the right project files.
- **Outcome Validation**: Checking if the agent actually did what it was supposed to do.
- **Error Handling**: Deciding what to do if a run fails (retry, stop, or call a different agent).

### 2. The Loop
A **Loop** is a pattern where an agent is run repeatedly to refine a result or achieve a multi-step goal. The most common pattern is the **"Ralph Wiggum Loop"**, where the agent's own output suggests the next task.

### 3. The Flow
A **Flow** is a sequence of different agents working together (e.g., a Planner agent creates a task list, and an Implementer agent executes each task).

---

## Pattern: The Ralph Wiggum Loop

This loop runs a single agent repeatedly. In each turn, the agent provides a `handoff.nextTask`. The loop continues as long as a next task is suggested.

### Example Script (`loop.ts`)

```ts
import { createAiman } from "aiman";

async function runLoop(agentName: string, initialTask: string) {
   const aiman = await createAiman();
   let currentTask = initialTask;
   const limit = 5;

   for (let i = 0; i < limit; i++) {
      console.log(`\n--- Iteration ${i + 1} ---`);
      
      const result = await aiman.runs.run(agentName, { task: currentTask });

      if (result.status !== "success") break;

      // Check if the agent wants to continue
      if (result.handoff?.nextTask) {
         currentTask = result.handoff.nextTask;
      } else {
         console.log("Goal achieved.");
         break;
      }
   }
}
```

---

## Pattern: The Multi-Agent Flow

This pattern chains two different specialists together.

### Example Script (`flow.ts`)

```ts
import { createAiman } from "aiman";

async function runFlow(userGoal: string) {
   const aiman = await createAiman();

   // 1. Plan the work
   const plan = await aiman.runs.run("planner", { task: userGoal });
   if (plan.status !== "success") return;

   // 2. Execute based on the plan
   const execution = await aiman.runs.run("implementer", { 
      task: `Follow this plan: ${plan.summary}` 
   });
   
   console.log("Final Result:", execution.summary);
}
```

---

## Pattern: The Project Harness

Use a harness to ensure your agents always have the right context for your specific project.

### Example Script (`harness.ts`)

```ts
import { createAiman } from "aiman";

async function runInHarness(task: string) {
   const aiman = await createAiman();
   
   // A custom harness can perform pre-run checks
   console.log("Preparing environment...");

   const result = await aiman.runs.run("worker", {
      task,
      onRunStarted: (run) => {
         console.log(`Running in harness: ${run.runId}`);
      }
   });

   // A custom harness can perform post-run validation
   if (result.status === "success") {
      console.log("Validating artifacts...");
      // e.g., run `npm test` here
   }

   return result;
}
```

---

## Instructions for Agents

If you are an AI agent helping to build a flow in this repository:

1. **Prefer Standalone Scripts**: Write the flow in a `.ts` file that can be run with `bun`.
2. **Use the `createAiman` API**: Never try to parse CLI output if you can use the programmatic API.
3. **Respect the JSON Contract**: Ensure your agents are authored to return the standard handoff/result structure.
4. **Zero Config**: Aim for scripts that can be run without adding new entries to `package.json`.
