import { spawn } from "node:child_process";

import { assemblePrompt } from "./context.mjs";
import {
  AgentNotFoundError,
  RunNotFoundError,
  toAppError
} from "./errors.mjs";
import { buildRunPlan } from "./providers/index.mjs";

export class RunManager {
  constructor({
    rootDir,
    agentRegistry,
    runStore,
    killGraceMs = 1000
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
    model = null
  }) {
    const agent = await this.agentRegistry.getVisibleAgent(agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName);
    }

    const selectedModel = model ?? agent.model;
    const assembledPrompt = await assemblePrompt({
      rootDir: this.rootDir,
      workspace,
      agent,
      taskPrompt
    });
    const plan = buildRunPlan({
      agent,
      model: selectedModel ?? "",
      workspace,
      assembledPrompt
    });
    const run = await this.runStore.createRun({
      agentName: agent.name,
      agentSource: agent.source,
      provider: agent.provider,
      model: selectedModel ?? "",
      taskPrompt,
      assembledPrompt,
      workspace,
      writeScope,
      timeoutMs,
      command: plan.command,
      args: plan.args
    });

    await this.runStore.appendEvent(run.id, "queued", {
      command: plan.command,
      args: plan.args,
      workspace,
      model: selectedModel ?? "",
      timeoutMs
    });

    if (dryRun) {
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

    const child = spawn(plan.command, plan.args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...plan.env,
        AGENT_RUN_ID: run.id,
        AGENT_NAME: agent.name,
        AGENT_MODEL: selectedModel ?? ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const activeRun = {
      child,
      timeoutId: null,
      killTimeoutId: null
    };
    this.activeRuns.set(run.id, activeRun);

    await this.runStore.updateRun(run.id, {
      status: "running",
      pid: child.pid,
      startedAt: new Date().toISOString()
    });

    await this.runStore.appendEvent(run.id, "started", {
      pid: child.pid
    });

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      activeRun.timeoutId = setTimeout(() => {
        void this.#handleRunTimeout(run.id, timeoutMs);
      }, timeoutMs);
    }

    child.stdout.on("data", async (chunk) => {
      await this.runStore.appendEvent(run.id, "stdout", {
        text: chunk.toString()
      });
    });

    child.stderr.on("data", async (chunk) => {
      await this.runStore.appendEvent(run.id, "stderr", {
        text: chunk.toString()
      });
    });

    child.on("error", async (error) => {
      const appError = toAppError(error);
      this.#clearActiveRun(run.id);
      await this.#finalizeRun(run.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        exitCode: -1,
        resultSummary: appError.message
      }, "error", {
        error: appError
      });
    });

    child.on("close", async (code, signal) => {
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
        : `Run failed with exit code ${code}.`;

      await this.#finalizeRun(run.id, {
        status: code === 0 ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
        exitCode: code,
        resultSummary: code === 0 ? "Run completed successfully." : failedSummary
      }, code === 0 ? "completed" : "failed", {
        exitCode: code,
        signal
      });
    });

    return this.runStore.getRun(run.id);
  }

  async waitForRun(runId, timeoutMs = 30000) {
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

    return this.runStore.getRun(runId);
  }

  async cancelRun(runId) {
    const activeRun = this.activeRuns.get(runId);

    if (!activeRun) {
      const run = await this.runStore.getRun(runId);

      if (!run) {
        throw new RunNotFoundError(runId);
      }

      return run;
    }

    const run = await this.#finalizeRun(runId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      exitCode: null,
      resultSummary: "Run cancelled by user."
    }, "cancelled", {
      reason: "user"
    });

    await this.#requestTermination(runId, "cancel");
    return run;
  }

  #isTerminalStatus(status) {
    return status === "completed" || status === "failed" || status === "cancelled";
  }

  #clearActiveRun(runId) {
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

  async #finalizeRun(runId, update, eventType, payload) {
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

  async #requestTermination(runId, reason) {
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

  async #handleRunTimeout(runId, timeoutMs) {
    const activeRun = this.activeRuns.get(runId);

    if (!activeRun) {
      return;
    }

    await this.#finalizeRun(runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      exitCode: 124,
      resultSummary: `Run timed out after ${timeoutMs}ms and was terminated.`
    }, "timeout", {
      timeoutMs
    });

    await this.#requestTermination(runId, "timeout");
  }
}
