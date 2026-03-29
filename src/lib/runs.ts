import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { collectAgentRuntimeIssues, loadAgentDefinition } from "./agents.js";
import { UserError } from "./errors.js";
import {
   ensureProjectDirectories,
   getProjectPaths,
   resolveRunCwd
} from "./paths.js";
import {
   buildRunPaths,
   createFailedRunRecord,
   createRunId,
   persistResult,
   readRunDetails,
   readRunLog,
   toRunResult,
   writeRunState
} from "./run-store.js";
import { getAdapterForProvider } from "./providers/index.js";
import { readRunReport } from "./report.js";
import type { RunMode, RunResult } from "./types.js";

const defaultTimeoutMs = 5 * 60 * 1000;
const defaultKillGraceMs = 1 * 1000;

type RunAgentInput = {
   agentName: string;
   cwd?: string;
   killGraceMs?: number;
   mode: RunMode;
   task: string;
   timeoutMs?: number;
};

type ChildCompletion = {
   exitCode: number | null;
   signal: string | null;
   spawnError?: Error;
};

function waitForChildCompletion(
   child: ReturnType<typeof spawn>
): Promise<ChildCompletion> {
   let completed = false;

   return new Promise<ChildCompletion>((resolve) => {
      const resolveOnce = (value: ChildCompletion) => {
         if (!completed) {
            completed = true;
            resolve(value);
         }
      };

      child.once("error", (spawnError) => {
         resolveOnce({
            exitCode: null,
            signal: null,
            spawnError
         });
      });
      child.once("close", (exitCode, signal) => {
         resolveOnce({ exitCode, signal });
      });
   });
}

async function writeRunningState(input: {
   agent: string;
   cwd: string;
   mode: RunMode;
   pid?: number;
   provider: RunResult["provider"];
   reportFile: string;
   resultFile: string;
   runFile: string;
   runId: string;
   startedAt: string;
}): Promise<void> {
   await writeRunState(input.runFile, {
      agent: input.agent,
      cwd: input.cwd,
      mode: input.mode,
      provider: input.provider,
      reportFile: input.reportFile,
      resultFile: input.resultFile,
      runId: input.runId,
      startedAt: input.startedAt,
      status: "running",
      ...(typeof input.pid === "number" ? { pid: input.pid } : {})
   });
}

async function buildRunResult(
   record: Parameters<typeof toRunResult>[0]
): Promise<RunResult> {
   const result = toRunResult(record);
   const reportFile = record.paths.reportFile;
   const artifactsDir = record.paths.artifactsDir;

   if (typeof reportFile !== "string" || typeof artifactsDir !== "string") {
      return result;
   }

   const report = await readRunReport(reportFile, artifactsDir);

   return report.exists
      ? {
           ...result,
           reportPath: report.path
        }
      : result;
}

export async function runAgent(input: RunAgentInput): Promise<RunResult> {
   const projectPaths = getProjectPaths();
   await ensureProjectDirectories(projectPaths);

   const agent = await loadAgentDefinition(projectPaths, input.agentName);
   const issues = await collectAgentRuntimeIssues(agent);
   const errors = issues.filter((issue) => issue.level === "error");

   if (errors.length > 0) {
      throw new UserError(errors.map((issue) => issue.message).join("\n"));
   }

   const runId = createRunId(agent.name);
   const runDir = path.join(projectPaths.runsDir, runId);
   const runCwd = resolveRunCwd(projectPaths.projectRoot, input.cwd);
   const startedAt = new Date().toISOString();
   const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
   const killGraceMs = input.killGraceMs ?? defaultKillGraceMs;

   await mkdir(runDir, { recursive: true });
   const paths = buildRunPaths(runDir);
   await mkdir(paths.artifactsDir, { recursive: true });

   const adapter = getAdapterForProvider(agent.provider);
   const prepared = adapter.prepare(agent, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      mode: input.mode,
      promptFile: paths.promptFile,
      reportFile: paths.reportFile,
      resultFile: paths.resultFile,
      runId,
      task: input.task
   });

   await writeFile(paths.promptFile, prepared.renderedPrompt, "utf8");
   await writeRunningState({
      agent: agent.name,
      cwd: runCwd,
      mode: input.mode,
      provider: agent.provider,
      reportFile: paths.reportFile,
      resultFile: paths.resultFile,
      runFile: paths.runFile,
      runId,
      startedAt
   });

   const child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      stdio: "pipe"
   });
   const completionPromise = waitForChildCompletion(child);

   await writeRunningState({
      agent: agent.name,
      cwd: runCwd,
      mode: input.mode,
      provider: agent.provider,
      reportFile: paths.reportFile,
      resultFile: paths.resultFile,
      runFile: paths.runFile,
      runId,
      startedAt,
      ...(typeof child.pid === "number" ? { pid: child.pid } : {})
   });

   const stdoutLogStream = createWriteStream(paths.stdoutLog, {
      encoding: "utf8"
   });
   const stderrLogStream = createWriteStream(paths.stderrLog, {
      encoding: "utf8"
   });
   let stdout = "";
   let stderr = "";
   let timedOut = false;
   let completed = false;

   child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      stdoutLogStream.write(value);
   });
   child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      stderrLogStream.write(value);
   });

   if (prepared.stdin !== undefined && child.stdin) {
      child.stdin.write(prepared.stdin);
   }

   child.stdin?.end();

   let killTimer: NodeJS.Timeout | null = null;
   const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
         if (!completed) {
            child.kill("SIGKILL");
         }
      }, killGraceMs);
   }, timeoutMs);

   const completion = await completionPromise.finally(() => {
      completed = true;
      clearTimeout(timer);

      if (killTimer) {
         clearTimeout(killTimer);
      }

      stdoutLogStream.end();
      stderrLogStream.end();
   });
   const endedAt = new Date().toISOString();

   if (completion.spawnError) {
      const record = createFailedRunRecord({
         agent: agent.name,
         cwd: runCwd,
         endedAt,
         errorMessage: completion.spawnError.message,
         mode: input.mode,
         promptFile: paths.promptFile,
         provider: agent.provider,
         resultFile: paths.resultFile,
         runDir,
         runId,
         startedAt,
         stderrLog: paths.stderrLog,
         stdoutLog: paths.stdoutLog
      });

      await persistResult(record, paths.runFile);
      return buildRunResult(record);
   }

   const record = await adapter.parseCompletedRun({
      agent,
      cwd: runCwd,
      endedAt,
      exitCode: completion.exitCode,
      mode: input.mode,
      promptFile: paths.promptFile,
      resultFile: paths.resultFile,
      runDir,
      runId,
      signal: completion.signal,
      startedAt,
      stderr,
      stderrLog: paths.stderrLog,
      stdout,
      stdoutLog: paths.stdoutLog
   });
   const finalRecord = timedOut
      ? {
           ...record,
           errorMessage: "Execution timed out.",
           status: "error" as const
        }
      : record;

   await persistResult(finalRecord, paths.runFile);

   return buildRunResult(finalRecord);
}

export { readRunDetails, readRunLog, toRunResult };
