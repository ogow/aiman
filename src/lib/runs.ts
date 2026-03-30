import { spawn } from "node:child_process";
import type { WriteStream } from "node:fs";
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
import type { AgentScope, RunMode, RunResult } from "./types.js";

const defaultTimeoutMs = 5 * 60 * 1000;
const defaultKillGraceMs = 1 * 1000;

type RunAgentInput = {
   agentName: string;
   agentScope?: AgentScope;
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
   agentPath: string;
   agentScope: AgentScope;
   cwd: string;
   mode: RunMode;
   pid?: number;
   promptFile: string;
   provider: RunResult["provider"];
   runDir: string;
   runFile: string;
   runId: string;
   stderrLog: string;
   startedAt: string;
   stdoutLog: string;
}): Promise<void> {
   await writeRunState(input.runFile, {
      agent: input.agent,
      agentPath: input.agentPath,
      agentScope: input.agentScope,
      cwd: input.cwd,
      mode: input.mode,
      paths: {
         artifactsDir: path.join(input.runDir, "artifacts"),
         promptFile: input.promptFile,
         runFile: input.runFile,
         runDir: input.runDir,
         stderrLog: input.stderrLog,
         stdoutLog: input.stdoutLog
      },
      provider: input.provider,
      runId: input.runId,
      startedAt: input.startedAt,
      status: "running",
      ...(typeof input.pid === "number" ? { pid: input.pid } : {})
   });
}

function createLazyLogWriter(filePath: string): {
   end(): void;
   write(value: string): void;
} {
   let stream: WriteStream | undefined;

   return {
      end() {
         stream?.end();
      },
      write(value) {
         if (stream === undefined) {
            stream = createWriteStream(filePath, {
               encoding: "utf8"
            });
         }

         stream.write(value);
      }
   };
}

export async function runAgent(input: RunAgentInput): Promise<RunResult> {
   const projectPaths = getProjectPaths();
   await ensureProjectDirectories(projectPaths);

   const agent = await loadAgentDefinition(
      projectPaths,
      input.agentName,
      input.agentScope
   );
   const issues = await collectAgentRuntimeIssues(agent);

   if (issues.length > 0) {
      throw new UserError(issues.map((issue) => issue.message).join("\n"));
   }

   const runId = createRunId(agent.name);
   const runDir = path.join(projectPaths.runsDir, runId);
   const runCwd = resolveRunCwd(projectPaths.projectRoot, input.cwd);
   const startedAt = new Date().toISOString();
   const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
   const killGraceMs = input.killGraceMs ?? defaultKillGraceMs;

   await mkdir(runDir, { recursive: true });
   const paths = buildRunPaths(runDir);

   const adapter = getAdapterForProvider(agent.provider);
   const prepared = adapter.prepare(agent, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      mode: input.mode,
      promptFile: paths.promptFile,
      runFile: paths.runFile,
      runId,
      task: input.task
   });

   await writeFile(paths.promptFile, prepared.renderedPrompt, "utf8");
   await writeRunningState({
      agent: agent.name,
      agentPath: agent.path,
      agentScope: agent.scope,
      cwd: runCwd,
      mode: input.mode,
      promptFile: paths.promptFile,
      provider: agent.provider,
      runDir,
      runFile: paths.runFile,
      runId,
      stderrLog: paths.stderrLog,
      startedAt,
      stdoutLog: paths.stdoutLog
   });

   const child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      stdio: "pipe"
   });
   const completionPromise = waitForChildCompletion(child);

   await writeRunningState({
      agent: agent.name,
      agentPath: agent.path,
      agentScope: agent.scope,
      cwd: runCwd,
      mode: input.mode,
      promptFile: paths.promptFile,
      provider: agent.provider,
      runDir,
      runFile: paths.runFile,
      runId,
      stderrLog: paths.stderrLog,
      startedAt,
      stdoutLog: paths.stdoutLog,
      ...(typeof child.pid === "number" ? { pid: child.pid } : {})
   });

   const stdoutLogWriter = createLazyLogWriter(paths.stdoutLog);
   const stderrLogWriter = createLazyLogWriter(paths.stderrLog);
   let stdout = "";
   let stderr = "";
   let timedOut = false;
   let completed = false;

   child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      stdoutLogWriter.write(value);
   });
   child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      stderrLogWriter.write(value);
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

      stdoutLogWriter.end();
      stderrLogWriter.end();
   });
   const endedAt = new Date().toISOString();

   if (completion.spawnError) {
      const record = createFailedRunRecord({
         agent: agent.name,
         agentPath: agent.path,
         agentScope: agent.scope,
         cwd: runCwd,
         endedAt,
         errorMessage: completion.spawnError.message,
         mode: input.mode,
         promptFile: paths.promptFile,
         provider: agent.provider,
         runDir,
         runId,
         startedAt,
         ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
         ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
      });

      await persistResult(record, paths.runFile);
      return toRunResult(record);
   }

   const record = await adapter.parseCompletedRun({
      agent,
      cwd: runCwd,
      endedAt,
      exitCode: completion.exitCode,
      mode: input.mode,
      promptFile: paths.promptFile,
      runDir,
      runId,
      signal: completion.signal,
      startedAt,
      stderr,
      ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
      stdout,
      ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
   });
   const finalRecord = timedOut
      ? {
           ...record,
           agentPath: agent.path,
           agentScope: agent.scope,
           errorMessage: "Execution timed out.",
           status: "error" as const
        }
      : {
           ...record,
           agentPath: agent.path,
           agentScope: agent.scope
        };

   await persistResult(finalRecord, paths.runFile);

   return toRunResult(finalRecord);
}

export { readRunDetails, readRunLog, toRunResult };
