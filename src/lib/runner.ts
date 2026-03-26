import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePrompt } from "./context.js";
import { AgentNotFoundError, RunNotFoundError, toAppError } from "./errors.js";
import { buildRunPlan } from "./providers/index.js";
import type { RunStore } from "./run-store.js";
import type { Agent, Run, RunStatus } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const currentExtension = path.extname(fileURLToPath(import.meta.url));
const tsxImportPath =
   currentExtension === ".ts" ? import.meta.resolve("tsx") : null;
const runWorkerPath = path.join(
   __dirname,
   "..",
   `run-worker${currentExtension === ".ts" ? ".ts" : ".js"}`
);

interface ActiveRun {
   child: ChildProcess;
   timeoutId: NodeJS.Timeout | null;
   killTimeoutId: NodeJS.Timeout | null;
}

export class RunManager {
   rootDir: string;
   agentRegistry: {
      getVisibleAgent(name: string): Promise<Agent | null>;
   };
   runStore: {
      createRun(input: Parameters<RunStore["createRun"]>[0]): Promise<Run>;
      appendEvent(
         runId: string,
         type: string,
         payload: unknown
      ): Promise<unknown>;
      updateRun(runId: string, update: Partial<Run>): Promise<Run>;
      getRun(runId: string): Promise<Run | null>;
   };
   activeRuns: Map<string, ActiveRun>;
   killGraceMs: number;

   constructor({
      rootDir,
      agentRegistry,
      runStore,
      killGraceMs = 1000
   }: {
      rootDir: string;
      agentRegistry: RunManager["agentRegistry"];
      runStore: RunManager["runStore"];
      killGraceMs?: number;
   }) {
      this.rootDir = rootDir;
      this.agentRegistry = agentRegistry;
      this.runStore = runStore;
      this.activeRuns = new Map();
      this.killGraceMs = killGraceMs;
   }

   async spawnRun({
      agentName,
      taskPrompt,
      workspace = this.rootDir,
      writeScope = [],
      timeoutMs = null,
      dryRun = false,
      model = null,
      reasoningEffort = null
   }: {
      agentName: string;
      taskPrompt: string;
      workspace?: string;
      writeScope?: string[];
      timeoutMs?: number | null;
      dryRun?: boolean;
      model?: string | null;
      reasoningEffort?: string | null;
   }): Promise<Run> {
      const run = await this.#prepareRun({
         agentName,
         taskPrompt,
         workspace,
         writeScope,
         timeoutMs,
         dryRun,
         model,
         reasoningEffort
      });

      if (dryRun || this.#isTerminalStatus(run.status)) {
         return run;
      }

      return this.startRun(run.id);
   }

   async spawnDetachedRun({
      agentName,
      taskPrompt,
      workspace = this.rootDir,
      writeScope = [],
      timeoutMs = null,
      dryRun = false,
      model = null,
      reasoningEffort = null
   }: {
      agentName: string;
      taskPrompt: string;
      workspace?: string;
      writeScope?: string[];
      timeoutMs?: number | null;
      dryRun?: boolean;
      model?: string | null;
      reasoningEffort?: string | null;
   }): Promise<Run> {
      const run = await this.#prepareRun({
         agentName,
         taskPrompt,
         workspace,
         writeScope,
         timeoutMs,
         dryRun,
         model,
         reasoningEffort
      });

      if (dryRun || this.#isTerminalStatus(run.status)) {
         return run;
      }

      const workerArgs =
         currentExtension === ".ts"
            ? ["--import", tsxImportPath as string, runWorkerPath]
            : [runWorkerPath];

      const worker = spawn(
         process.execPath,
         [...workerArgs, "--root-dir", this.rootDir, "--run-id", run.id],
         {
            cwd: this.rootDir,
            env: process.env,
            detached: true,
            stdio: "ignore"
         }
      );
      worker.unref();

      await this.runStore.appendEvent(run.id, "worker_spawned", {
         pid: worker.pid
      });

      return (await this.runStore.getRun(run.id)) as Run;
   }

   async startRun(runId: string): Promise<Run> {
      const run = await this.runStore.getRun(runId);

      if (!run) {
         throw new RunNotFoundError(runId);
      }

      if (run.status !== "pending") {
         return run;
      }

      const child = spawn(run.command, run.args, {
         cwd: run.workspace,
         env: {
            ...process.env,
            ...(run.env ?? {}),
            AGENT_RUN_ID: run.id,
            AGENT_NAME: run.agentName,
            AGENT_MODEL: run.model ?? "",
            AGENT_REASONING_EFFORT: run.reasoningEffort ?? ""
         },
         stdio: ["ignore", "pipe", "pipe"]
      });

      const stdout = child.stdout;
      const stderr = child.stderr;

      if (!stdout || !stderr) {
         throw new Error("Run process did not expose stdout/stderr streams.");
      }

      const activeRun: ActiveRun = {
         child,
         timeoutId: null,
         killTimeoutId: null
      };
      this.activeRuns.set(run.id, activeRun);

      await this.runStore.updateRun(run.id, {
         status: "running",
         pid: child.pid ?? null,
         startedAt: new Date().toISOString()
      });

      await this.runStore.appendEvent(run.id, "started", {
         pid: child.pid
      });

      const timeoutMsForRun = run.timeoutMs;

      if (typeof timeoutMsForRun === "number" && timeoutMsForRun > 0) {
         activeRun.timeoutId = setTimeout(() => {
            void this.#handleRunTimeout(run.id, timeoutMsForRun);
         }, timeoutMsForRun);
      }

      stdout.on("data", async (chunk: Buffer) => {
         await this.runStore.appendEvent(run.id, "stdout", {
            text: chunk.toString()
         });
      });

      stderr.on("data", async (chunk: Buffer) => {
         await this.runStore.appendEvent(run.id, "stderr", {
            text: chunk.toString()
         });
      });

      child.on("error", async (error: Error) => {
         const appError = toAppError(error);
         this.#clearActiveRun(run.id);
         await this.#finalizeRun(
            run.id,
            {
               status: "failed",
               finishedAt: new Date().toISOString(),
               exitCode: -1,
               resultSummary: appError.message
            },
            "error",
            {
               error: appError
            }
         );
      });

      child.on(
         "close",
         async (code: number | null, signal: NodeJS.Signals | null) => {
            this.#clearActiveRun(run.id);

            const currentRun = await this.runStore.getRun(run.id);

            if (!currentRun) {
               return;
            }

            if (this.#isTerminalStatus(currentRun.status)) {
               await this.runStore.appendEvent(run.id, "closed", {
                  exitCode: code,
                  signal
               });
               return;
            }

            const failedSummary = signal
               ? `Run terminated by signal ${signal}.`
               : `Run failed with exit code ${code ?? "unknown"}.`;

            await this.#finalizeRun(
               run.id,
               {
                  status: code === 0 ? "completed" : "failed",
                  finishedAt: new Date().toISOString(),
                  exitCode: code ?? null,
                  resultSummary:
                     code === 0 ? "Run completed successfully." : failedSummary
               },
               code === 0 ? "completed" : "failed",
               {
                  exitCode: code ?? null,
                  signal
               }
            );
         }
      );

      return (await this.runStore.getRun(run.id)) as Run;
   }

   async waitForRun(runId: string, timeoutMs = 30000): Promise<Run> {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
         const run = await this.runStore.getRun(runId);

         if (!run) {
            throw new RunNotFoundError(runId);
         }

         if (this.#isTerminalStatus(run.status)) {
            return run;
         }

         await new Promise((resolve) => setTimeout(resolve, 200));
      }

      return (await this.runStore.getRun(runId)) as Run;
   }

   async cancelRun(runId: string): Promise<Run> {
      const activeRun = this.activeRuns.get(runId);
      const currentRun = await this.runStore.getRun(runId);

      if (!currentRun) {
         throw new RunNotFoundError(runId);
      }

      if (this.#isTerminalStatus(currentRun.status)) {
         return currentRun;
      }

      const run = await this.#finalizeRun(
         runId,
         {
            status: "cancelled",
            finishedAt: new Date().toISOString(),
            exitCode: null,
            resultSummary: "Run cancelled by user."
         },
         "cancelled",
         {
            reason: "user"
         }
      );

      if (activeRun) {
         await this.#requestTermination(runId, "cancel");
      } else if (typeof currentRun.pid === "number") {
         await this.#requestTerminationByPid(runId, currentRun.pid, "cancel");
      }

      return run;
   }

   #isTerminalStatus(status: RunStatus): boolean {
      return (
         status === "completed" || status === "failed" || status === "cancelled"
      );
   }

   #clearActiveRun(runId: string): void {
      const activeRun = this.activeRuns.get(runId);

      if (!activeRun) {
         return;
      }

      if (activeRun.timeoutId) {
         clearTimeout(activeRun.timeoutId);
      }

      if (activeRun.killTimeoutId) {
         clearTimeout(activeRun.killTimeoutId);
      }

      this.activeRuns.delete(runId);
   }

   async #finalizeRun(
      runId: string,
      update: Partial<Run>,
      eventType: string,
      payload: unknown
   ): Promise<Run> {
      const currentRun = await this.runStore.getRun(runId);

      if (!currentRun) {
         throw new RunNotFoundError(runId);
      }

      if (this.#isTerminalStatus(currentRun.status)) {
         return currentRun;
      }

      const run = await this.runStore.updateRun(runId, update);
      await this.runStore.appendEvent(runId, eventType, payload);
      return run;
   }

   async #requestTermination(runId: string, reason: string): Promise<void> {
      const activeRun = this.activeRuns.get(runId);

      if (!activeRun) {
         return;
      }

      activeRun.child.kill("SIGTERM");
      await this.runStore.appendEvent(runId, "termination_requested", {
         reason,
         signal: "SIGTERM"
      });

      activeRun.killTimeoutId = setTimeout(() => {
         const latestRun = this.activeRuns.get(runId);

         if (!latestRun) {
            return;
         }

         latestRun.child.kill("SIGKILL");
         void this.runStore.appendEvent(runId, "kill_escalated", {
            reason,
            signal: "SIGKILL"
         });
      }, this.killGraceMs);
   }

   async #requestTerminationByPid(
      runId: string,
      pid: number,
      reason: string
   ): Promise<void> {
      try {
         process.kill(pid, "SIGTERM");
      } catch (error) {
         if (
            !(
               typeof error === "object" &&
               error !== null &&
               "code" in error &&
               error.code === "ESRCH"
            )
         ) {
            throw error;
         }
      }

      await this.runStore.appendEvent(runId, "termination_requested", {
         reason,
         signal: "SIGTERM"
      });

      await new Promise((resolve) => setTimeout(resolve, this.killGraceMs));

      try {
         process.kill(pid, 0);
      } catch {
         return;
      }

      try {
         process.kill(pid, "SIGKILL");
         await this.runStore.appendEvent(runId, "kill_escalated", {
            reason,
            signal: "SIGKILL"
         });
      } catch (error) {
         if (
            !(
               typeof error === "object" &&
               error !== null &&
               "code" in error &&
               error.code === "ESRCH"
            )
         ) {
            throw error;
         }
      }
   }

   async #handleRunTimeout(runId: string, timeoutMs: number): Promise<void> {
      const activeRun = this.activeRuns.get(runId);

      if (!activeRun) {
         return;
      }

      await this.#finalizeRun(
         runId,
         {
            status: "failed",
            finishedAt: new Date().toISOString(),
            exitCode: 124,
            resultSummary: `Run timed out after ${timeoutMs}ms and was terminated.`
         },
         "timeout",
         {
            timeoutMs
         }
      );

      await this.#requestTermination(runId, "timeout");
   }

   async #prepareRun({
      agentName,
      taskPrompt,
      workspace,
      writeScope,
      timeoutMs,
      dryRun,
      model,
      reasoningEffort
   }: {
      agentName: string;
      taskPrompt: string;
      workspace: string;
      writeScope: string[];
      timeoutMs: number | null;
      dryRun: boolean;
      model: string | null;
      reasoningEffort: string | null;
   }): Promise<Run> {
      const agent = await this.agentRegistry.getVisibleAgent(agentName);

      if (!agent) {
         throw new AgentNotFoundError(agentName);
      }

      const selectedModel = model ?? agent.model;
      const selectedReasoningEffort = reasoningEffort ?? agent.reasoningEffort;
      const assembledPrompt = await assemblePrompt({
         rootDir: this.rootDir,
         workspace,
         agent,
         taskPrompt
      });
      const plan = buildRunPlan({
         agent,
         model: selectedModel ?? "",
         reasoningEffort: selectedReasoningEffort ?? "",
         workspace,
         assembledPrompt
      });
      const run = await this.runStore.createRun({
         agentName: agent.name,
         agentSource: agent.source,
         provider: agent.provider,
         model: selectedModel ?? "",
         reasoningEffort: selectedReasoningEffort ?? "",
         taskPrompt,
         assembledPrompt,
         workspace,
         writeScope,
         timeoutMs,
         command: plan.command,
         args: plan.args,
         env: plan.env
      });

      await this.runStore.appendEvent(run.id, "queued", {
         command: plan.command,
         args: plan.args,
         workspace,
         model: selectedModel ?? "",
         reasoningEffort: selectedReasoningEffort ?? "",
         timeoutMs
      });

      if (!dryRun) {
         return run;
      }

      const completedRun = await this.runStore.updateRun(run.id, {
         status: "completed",
         startedAt: new Date().toISOString(),
         finishedAt: new Date().toISOString(),
         exitCode: 0,
         resultSummary: "Dry run completed. No process was spawned."
      });

      await this.runStore.appendEvent(run.id, "completed", {
         dryRun: true
      });

      return completedRun;
   }
}
