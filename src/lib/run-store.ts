import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { getProjectPaths } from "./paths.js";
import { readRunReport } from "./report.js";
import type {
   RunInspection,
   PersistedRunRecord,
   RunResult,
   RunMode,
   RunPaths,
   StoredRunState
} from "./types.js";

type StoredRunPaths = RunPaths & {
   artifactsDir: string;
   reportFile: string;
   runFile: string;
};

export function createRunId(agentName: string): string {
   const iso = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
   const safeAgentName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

   return `${iso}-${safeAgentName}-${randomUUID().slice(0, 8)}`;
}

export function buildRunPaths(runDir: string): StoredRunPaths {
   return {
      artifactsDir: path.join(runDir, "artifacts"),
      promptFile: path.join(runDir, "prompt.md"),
      reportFile: path.join(runDir, "report.md"),
      resultFile: path.join(runDir, "result.json"),
      runFile: path.join(runDir, "run.json"),
      runDir,
      stderrLog: path.join(runDir, "stderr.log"),
      stdoutLog: path.join(runDir, "stdout.log")
   };
}

export function createFailedRunRecord(input: {
   agent: string;
   cwd: string;
   endedAt: string;
   errorMessage: string;
   mode: RunMode;
   promptFile: string;
   provider: PersistedRunRecord["provider"];
   resultFile: string;
   runDir: string;
   runId: string;
   startedAt: string;
   stderrLog: string;
   stdoutLog: string;
}): PersistedRunRecord {
   return {
      agent: input.agent,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      errorMessage: input.errorMessage,
      exitCode: null,
      finalText: "",
      mode: input.mode,
      paths: {
         artifactsDir: path.join(input.runDir, "artifacts"),
         promptFile: input.promptFile,
         reportFile: path.join(input.runDir, "report.md"),
         resultFile: input.resultFile,
         runDir: input.runDir,
         stderrLog: input.stderrLog,
         stdoutLog: input.stdoutLog
      },
      provider: input.provider,
      runId: input.runId,
      signal: null,
      startedAt: input.startedAt,
      status: "error"
   };
}

export function toRunResult(record: PersistedRunRecord): RunResult {
   return {
      agent: record.agent,
      finalText: record.finalText,
      mode: record.mode,
      provider: record.provider,
      runId: record.runId,
      status: record.status,
      ...(typeof record.errorMessage === "string"
         ? { errorMessage: record.errorMessage }
         : {})
   };
}

export async function writeRunState(
   filePath: string,
   value: StoredRunState
): Promise<void> {
   await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
   const raw = await readFile(filePath, "utf8");
   return JSON.parse(raw) as T;
}

export async function persistResult(
   record: PersistedRunRecord,
   runFile: string
): Promise<void> {
   await writeFile(
      record.paths.resultFile,
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
   );
   await writeRunState(runFile, {
      agent: record.agent,
      cwd: record.cwd,
      endedAt: record.endedAt,
      mode: record.mode,
      provider: record.provider,
      ...(typeof record.paths.reportFile === "string"
         ? { reportFile: record.paths.reportFile }
         : {}),
      resultFile: record.paths.resultFile,
      runId: record.runId,
      startedAt: record.startedAt,
      status: record.status,
      ...(typeof record.errorMessage === "string"
         ? { errorMessage: record.errorMessage }
         : {})
   });
}

export async function readRunDetails(runId: string): Promise<RunInspection> {
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
   const report = await readRunReport(paths.reportFile, paths.artifactsDir);

   try {
      const record = await readJsonFile<PersistedRunRecord>(paths.resultFile);
      return {
         ...record,
         report
      };
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         const state = await readJsonFile<StoredRunState>(paths.runFile);
         return {
            ...state,
            report
         };
      }

      throw error;
   }
}

export async function readRunLog(
   runId: string,
   stream: "stderr" | "stdout"
): Promise<string> {
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const filePath = path.join(
      runDir,
      stream === "stderr" ? "stderr.log" : "stdout.log"
   );

   try {
      return await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         throw new UserError(`No ${stream} log exists for run "${runId}".`);
      }

      throw error;
   }
}
