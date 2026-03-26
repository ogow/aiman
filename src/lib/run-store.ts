import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";

import type {
   Run,
   RunCreateInput,
   RunEvent,
   RunState,
   RunUpdate
} from "./types.js";

const EMPTY_STATE: RunState = {
   runs: []
};

const runSchema = z.object({
   id: z.string(),
   agentName: z.string(),
   agentSource: z.enum(["home", "project"]),
   provider: z.string(),
   model: z.string(),
   reasoningEffort: z.string(),
   status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
   taskPrompt: z.string(),
   assembledPrompt: z.string(),
   workspace: z.string(),
   writeScope: z.array(z.string()),
   timeoutMs: z.number().int().positive().nullable(),
   command: z.string(),
   args: z.array(z.string()),
   env: z.record(z.string(), z.string()),
   createdAt: z.string(),
   startedAt: z.string().nullable(),
   finishedAt: z.string().nullable(),
   exitCode: z.number().int().nullable(),
   pid: z.number().int().nullable(),
   resultSummary: z.string().nullable()
});
const runEventSchema = z.object({
   timestamp: z.string(),
   type: z.string(),
   payload: z.unknown()
});
const runStateSchema = z.object({
   runs: z.array(runSchema)
});

async function exists(filePath: string): Promise<boolean> {
   try {
      await stat(filePath);
      return true;
   } catch {
      return false;
   }
}

export class RunStore {
   workspaceDir: string;
   storageDir: string;
   statePath: string;
   tracesDir: string;

   constructor(workspaceDir: string) {
      this.workspaceDir = workspaceDir;
      this.storageDir = path.join(workspaceDir, ".aiman");
      this.statePath = path.join(this.storageDir, "state.json");
      this.tracesDir = path.join(this.storageDir, "traces");
   }

   async init(): Promise<void> {
      await mkdir(this.storageDir, { recursive: true });
      await mkdir(this.tracesDir, { recursive: true });

      if (!(await exists(this.statePath))) {
         await this.#writeState(EMPTY_STATE);
      }
   }

   async listRuns(): Promise<Run[]> {
      const state = await this.#readState();
      return state.runs;
   }

   async getRun(runId: string): Promise<Run | null> {
      const state = await this.#readState();
      return state.runs.find((run) => run.id === runId) ?? null;
   }

   async createRun(input: RunCreateInput): Promise<Run> {
      const state = await this.#readState();
      const now = new Date().toISOString();
      const run: Run = {
         id: input.id ?? randomUUID(),
         agentName: input.agentName,
         agentSource: input.agentSource,
         provider: input.provider,
         model: input.model ?? "",
         reasoningEffort: input.reasoningEffort ?? "",
         status: input.status ?? "pending",
         taskPrompt: input.taskPrompt,
         assembledPrompt: input.assembledPrompt,
         workspace: input.workspace,
         writeScope: input.writeScope ?? [],
         timeoutMs: input.timeoutMs ?? null,
         command: input.command,
         args: input.args ?? [],
         env: input.env ?? {},
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

   async updateRun(runId: string, update: RunUpdate): Promise<Run> {
      const state = await this.#readState();
      const index = state.runs.findIndex((run) => run.id === runId);

      if (index === -1) {
         throw new Error(`Run not found: ${runId}`);
      }

      const existingRun = state.runs[index];

      if (!existingRun) {
         throw new Error(`Run not found: ${runId}`);
      }

      state.runs[index] = {
         ...existingRun,
         ...update
      };

      await this.#writeState(state);
      return state.runs[index];
   }

   async appendEvent<TPayload>(
      runId: string,
      type: string,
      payload: TPayload
   ): Promise<RunEvent<TPayload>> {
      const event: RunEvent<TPayload> = {
         timestamp: new Date().toISOString(),
         type,
         payload
      };

      const tracePath = path.join(this.tracesDir, `${runId}.jsonl`);
      await writeFile(tracePath, `${JSON.stringify(event)}\n`, { flag: "a" });
      return event;
   }

   async readEvents(runId: string, limit = 200): Promise<RunEvent[]> {
      const tracePath = path.join(this.tracesDir, `${runId}.jsonl`);

      if (!(await exists(tracePath))) {
         return [];
      }

      const raw = await readFile(tracePath, "utf8");
      const events = raw
         .split("\n")
         .filter(Boolean)
         .map((line) => runEventSchema.parse(JSON.parse(line)));

      return limit > 0 ? events.slice(-limit) : events;
   }

   async #readState(): Promise<RunState> {
      const raw = await readFile(this.statePath, "utf8");
      return runStateSchema.parse(JSON.parse(raw));
   }

   async #writeState(state: RunState): Promise<void> {
      const tempPath = `${this.statePath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(tempPath, this.statePath);
   }
}
