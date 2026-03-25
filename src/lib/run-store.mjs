import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = {
  runs: []
};

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export class RunStore {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.storageDir = path.join(workspaceDir, ".aiman");
    this.statePath = path.join(this.storageDir, "state.json");
    this.tracesDir = path.join(this.storageDir, "traces");
  }

  async init() {
    await mkdir(this.storageDir, { recursive: true });
    await mkdir(this.tracesDir, { recursive: true });

    if (!(await exists(this.statePath))) {
      await this.#writeState(EMPTY_STATE);
    }
  }

  async listRuns() {
    const state = await this.#readState();
    return state.runs;
  }

  async getRun(runId) {
    const state = await this.#readState();
    return state.runs.find((run) => run.id === runId) ?? null;
  }

  async createRun(input) {
    const state = await this.#readState();
    const now = new Date().toISOString();
    const run = {
      id: input.id ?? randomUUID(),
      agentName: input.agentName,
      agentSource: input.agentSource,
      provider: input.provider,
      model: input.model ?? "",
      status: input.status ?? "pending",
      taskPrompt: input.taskPrompt,
      assembledPrompt: input.assembledPrompt,
      workspace: input.workspace,
      writeScope: input.writeScope ?? [],
      timeoutMs: input.timeoutMs ?? null,
      command: input.command,
      args: input.args ?? [],
      createdAt: now,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      exitCode: input.exitCode ?? null,
      pid: input.pid ?? null,
      resultSummary: input.resultSummary ?? null
    };

    state.runs.push(run);
    await this.#writeState(state);
    return run;
  }

  async updateRun(runId, update) {
    const state = await this.#readState();
    const index = state.runs.findIndex((run) => run.id === runId);

    if (index === -1) {
      throw new Error(`Run not found: ${runId}`);
    }

    state.runs[index] = {
      ...state.runs[index],
      ...update
    };

    await this.#writeState(state);
    return state.runs[index];
  }

  async appendEvent(runId, type, payload) {
    const event = {
      timestamp: new Date().toISOString(),
      type,
      payload
    };

    const tracePath = path.join(this.tracesDir, `${runId}.jsonl`);
    await writeFile(tracePath, `${JSON.stringify(event)}\n`, { flag: "a" });
    return event;
  }

  async readEvents(runId, limit = 200) {
    const tracePath = path.join(this.tracesDir, `${runId}.jsonl`);

    if (!(await exists(tracePath))) {
      return [];
    }

    const raw = await readFile(tracePath, "utf8");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return limit > 0 ? events.slice(-limit) : events;
  }

  async #readState() {
    const raw = await readFile(this.statePath, "utf8");
    return JSON.parse(raw);
  }

  async #writeState(state) {
    const tempPath = `${this.statePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}
