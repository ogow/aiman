import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { collectAgentRuntimeIssues, loadAgentDefinition } from "./agents.js";
import { UserError } from "./errors.js";
import {
   ensureProjectDirectories,
   getProjectPaths,
   resolveRunCwd
} from "./paths.js";
import { formatRunRights } from "./provider-capabilities.js";
import {
   buildRunPaths,
   createFailedRunRecord,
   createRunId,
   listRunDetails,
   persistResult,
   readRunDetails,
   readRunLog,
   toRunResult,
   writeRunState,
   writeRunStateIfRunning
} from "./run-store.js";
import { getAdapterForProvider } from "./providers/index.js";
import { resolveDeclaredSkills } from "./skills.js";
import type {
   AgentScope,
   LaunchMode,
   LaunchedRun,
   PreparedInvocation,
   PromptTransport,
   ProviderId,
   ResolvedSkill,
   RunLaunchSnapshot,
   RunInspection,
   RunListOptions,
   RunMode,
   RunResult,
   ScopedAgentDefinition
} from "./types.js";

const defaultTimeoutMs = 5 * 60 * 1000;
const defaultKillGraceMs = 1 * 1000;
const promptArgumentPlaceholder = "@prompt.md";
const runHeartbeatIntervalMs = 1000;

type RunAgentInput = {
   agentName: string;
   agentScope?: AgentScope;
   cwd?: string;
   killGraceMs?: number;
   mode?: RunMode;
   onRunStarted?: (input: {
      agent: string;
      agentPath: string;
      agentScope: AgentScope;
      provider: ProviderId;
      runId: string;
      startedAt: string;
   }) => void;
   task: string;
   timeoutMs?: number;
};

type PreparedRun = {
   agent: ScopedAgentDefinition;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   mode: RunMode;
   prepared: PreparedInvocation;
   resolvedSkills: ResolvedSkill[];
   runCwd: string;
   runDir: string;
   runId: string;
   startedAt: string;
   timeoutMs: number;
   killGraceMs: number;
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
   agent: ScopedAgentDefinition;
   cwd: string;
   heartbeatAt?: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   mode: RunMode;
   onlyIfRunning?: boolean;
   pid?: number;
   runDir: string;
   runId: string;
   startedAt: string;
}): Promise<void> {
   const paths = buildRunPaths(input.runDir);
   const nextState = {
      agent: input.agent.name,
      agentPath: input.agent.path,
      agentScope: input.agent.scope,
      cwd: input.cwd,
      ...(typeof input.heartbeatAt === "string"
         ? { heartbeatAt: input.heartbeatAt }
         : { heartbeatAt: new Date().toISOString() }),
      launch: input.launch,
      launchMode: input.launchMode,
      ...(typeof input.agent.model === "string"
         ? { model: input.agent.model }
         : {}),
      mode: input.mode,
      paths,
      provider: input.agent.provider,
      ...(typeof input.agent.reasoningEffort === "string"
         ? { reasoningEffort: input.agent.reasoningEffort }
         : {}),
      runId: input.runId,
      startedAt: input.startedAt,
      status: "running",
      ...(typeof input.pid === "number" ? { pid: input.pid } : {})
   } satisfies Parameters<typeof writeRunState>[1];

   if (input.onlyIfRunning === true) {
      await writeRunStateIfRunning(paths.runFile, nextState);
      return;
   }

   await writeRunState(paths.runFile, nextState);
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

function waitForDetachedLaunch(
   child: ChildProcess
): Promise<number | undefined> {
   return new Promise((resolve, reject) => {
      const handleSpawn = () => {
         cleanup();
         resolve(typeof child.pid === "number" ? child.pid : undefined);
      };
      const handleError = (error: Error) => {
         cleanup();
         reject(error);
      };
      const cleanup = () => {
         child.off("spawn", handleSpawn);
         child.off("error", handleError);
      };

      child.once("spawn", handleSpawn);
      child.once("error", handleError);
   });
}

function startRunHeartbeat(input: {
   preparedRun: PreparedRun;
   pid?: number;
}): () => Promise<void> {
   let stopped = false;
   let lastWrite = Promise.resolve();

   const scheduleWrite = () => {
      lastWrite = lastWrite
         .catch(() => undefined)
         .then(async () => {
            if (stopped) {
               return;
            }

            await writeRunningState({
               agent: input.preparedRun.agent,
               cwd: input.preparedRun.runCwd,
               heartbeatAt: new Date().toISOString(),
               launch: input.preparedRun.launch,
               launchMode: input.preparedRun.launchMode,
               mode: input.preparedRun.mode,
               ...(typeof input.pid === "number" ? { pid: input.pid } : {}),
               runDir: input.preparedRun.runDir,
               runId: input.preparedRun.runId,
               startedAt: input.preparedRun.startedAt
            });
         })
         .catch(() => undefined);
   };
   const interval = setInterval(scheduleWrite, runHeartbeatIntervalMs);

   interval.unref?.();

   return async () => {
      stopped = true;
      clearInterval(interval);
      await lastWrite;
   };
}

async function persistDetachedLaunchFailure(
   preparedRun: PreparedRun,
   errorMessage: string
): Promise<void> {
   const paths = buildRunPaths(preparedRun.runDir);
   const record = createFailedRunRecord({
      agent: preparedRun.agent.name,
      agentPath: preparedRun.agent.path,
      agentScope: preparedRun.agent.scope,
      cwd: preparedRun.runCwd,
      endedAt: new Date().toISOString(),
      errorMessage,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      ...(typeof preparedRun.agent.model === "string"
         ? { model: preparedRun.agent.model }
         : {}),
      mode: preparedRun.mode,
      promptFile: paths.promptFile,
      provider: preparedRun.agent.provider,
      ...(typeof preparedRun.agent.reasoningEffort === "string"
         ? { reasoningEffort: preparedRun.agent.reasoningEffort }
         : {}),
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   await persistResult(record, paths.runFile);
}

function hashText(value: string): string {
   return createHash("sha256").update(value).digest("hex");
}

function snapshotInvocationArgs(input: PreparedInvocation): string[] {
   if (input.promptTransport !== "arg") {
      return [...input.args];
   }

   return input.args.map((arg) =>
      arg === input.renderedPrompt ? promptArgumentPlaceholder : arg
   );
}

function restoreInvocationArgs(
   args: string[],
   promptTransport: PromptTransport,
   renderedPrompt: string
): string[] {
   if (promptTransport !== "arg") {
      return [...args];
   }

   return args.map((arg) =>
      arg === promptArgumentPlaceholder ? renderedPrompt : arg
   );
}

function buildLaunchEnvironment(input: {
   envKeys: string[];
   paths: ReturnType<typeof buildRunPaths>;
   runId: string;
}): Record<string, string> {
   return Object.fromEntries(
      input.envKeys.flatMap((key) => {
         const value =
            key === "AIMAN_ARTIFACTS_DIR"
               ? input.paths.artifactsDir
               : key === "AIMAN_RUN_PATH"
                 ? input.paths.runFile
                 : key === "AIMAN_RUN_DIR"
                   ? input.paths.runDir
                   : key === "AIMAN_RUN_ID"
                     ? input.runId
                     : process.env[key];

         return typeof value === "string" ? ([[key, value]] as const) : [];
      })
   );
}

async function buildLaunchSnapshot(input: {
   agent: ScopedAgentDefinition;
   killGraceMs: number;
   launchMode: LaunchMode;
   mode: RunMode;
   prepared: PreparedInvocation;
   resolvedSkills: ResolvedSkill[];
   timeoutMs: number;
}): Promise<RunLaunchSnapshot> {
   const agentSource = await readFile(input.agent.path, "utf8");

   return {
      agentDigest: hashText(agentSource),
      agentName: input.agent.name,
      agentPath: input.agent.path,
      agentScope: input.agent.scope,
      args: snapshotInvocationArgs(input.prepared),
      command: input.prepared.command,
      cwd: input.prepared.cwd,
      envKeys: Object.keys(input.prepared.env).sort(),
      killGraceMs: input.killGraceMs,
      launchMode: input.launchMode,
      ...(typeof input.agent.model === "string"
         ? { model: input.agent.model }
         : {}),
      mode: input.mode,
      permissions: input.agent.permissions,
      promptDigest: hashText(input.prepared.renderedPrompt),
      promptTransport: input.prepared.promptTransport,
      provider: input.agent.provider,
      ...(typeof input.agent.reasoningEffort === "string"
         ? { reasoningEffort: input.agent.reasoningEffort }
         : {}),
      skills: input.resolvedSkills,
      timeoutMs: input.timeoutMs
   };
}

async function resolveAgentForRun(input: {
   agentName: string;
   agentScope?: AgentScope;
}): Promise<ScopedAgentDefinition> {
   const projectPaths = getProjectPaths();
   const agent = await loadAgentDefinition(
      projectPaths,
      input.agentName,
      input.agentScope
   );
   const issues = await collectAgentRuntimeIssues(agent);

   if (issues.length > 0) {
      throw new UserError(issues.map((issue) => issue.message).join("\n"));
   }

   return agent;
}

async function prepareRun(
   input: RunAgentInput,
   launchMode: LaunchMode
): Promise<PreparedRun> {
   const projectPaths = getProjectPaths();
   await ensureProjectDirectories(projectPaths);

   const agent = await resolveAgentForRun({
      agentName: input.agentName,
      ...(input.agentScope !== undefined
         ? { agentScope: input.agentScope }
         : {})
   });
   const runId = createRunId(agent.name);
   const runDir = path.join(projectPaths.runsDir, runId);
   const runCwd = resolveRunCwd(projectPaths.projectRoot, input.cwd);
   const startedAt = new Date().toISOString();
   const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
   const killGraceMs = input.killGraceMs ?? defaultKillGraceMs;
   const mode = input.mode ?? agent.permissions;

   if (input.mode !== undefined && input.mode !== agent.permissions) {
      throw new UserError(
         `Agent "${agent.name}" only allows ${agent.permissions} execution, but received --mode ${input.mode}.`
      );
   }

   await mkdir(runDir, { recursive: true });
   const paths = buildRunPaths(runDir);
   const resolvedSkills = await resolveDeclaredSkills(
      projectPaths,
      agent.skills
   );
   const adapter = getAdapterForProvider(agent.provider);
   const prepared = adapter.prepare(agent, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      mode,
      promptFile: paths.promptFile,
      runFile: paths.runFile,
      runId,
      task: input.task
   });
   const launch = await buildLaunchSnapshot({
      agent,
      killGraceMs,
      launchMode,
      mode,
      prepared,
      resolvedSkills,
      timeoutMs
   });

   await writeFile(paths.promptFile, prepared.renderedPrompt, "utf8");
   await writeRunningState({
      agent,
      launchMode,
      cwd: runCwd,
      launch,
      mode,
      runDir,
      runId,
      startedAt
   });

   return {
      agent,
      killGraceMs,
      launch,
      launchMode,
      mode,
      prepared,
      resolvedSkills,
      runCwd,
      runDir,
      runId,
      startedAt,
      timeoutMs
   };
}

async function loadPreparedRun(runId: string): Promise<PreparedRun> {
   const run = await readRunDetails(runId);

   if (run.status !== "running") {
      throw new UserError(`Run "${runId}" is already complete.`);
   }

   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
   const renderedPrompt = await readFile(paths.promptFile, "utf8");
   const agent: ScopedAgentDefinition = {
      body: renderedPrompt,
      description: "",
      id: run.launch.agentName,
      name: run.launch.agentName,
      path: run.launch.agentPath,
      permissions: run.launch.permissions,
      provider: run.launch.provider,
      scope: run.launch.agentScope,
      ...(run.launch.skills.length > 0
         ? { skills: run.launch.skills.map((skill) => skill.name) }
         : {}),
      ...(typeof run.launch.model === "string"
         ? { model: run.launch.model }
         : {}),
      ...(typeof run.launch.reasoningEffort === "string"
         ? { reasoningEffort: run.launch.reasoningEffort }
         : {})
   };

   return {
      agent,
      killGraceMs: run.launch.killGraceMs,
      launch: run.launch,
      launchMode: run.launchMode,
      prepared: {
         args: restoreInvocationArgs(
            run.launch.args,
            run.launch.promptTransport,
            renderedPrompt
         ),
         command: run.launch.command,
         cwd: run.launch.cwd,
         env: buildLaunchEnvironment({
            envKeys: run.launch.envKeys,
            paths,
            runId
         }),
         promptTransport: run.launch.promptTransport,
         renderedPrompt,
         ...(run.launch.promptTransport === "stdin"
            ? { stdin: renderedPrompt }
            : {})
      },
      mode: run.mode,
      resolvedSkills: run.launch.skills,
      runCwd: run.launch.cwd,
      runDir,
      runId,
      startedAt: run.startedAt,
      timeoutMs: run.launch.timeoutMs
   };
}

async function executePreparedRun(
   preparedRun: PreparedRun,
   options?: {
      mirrorOutput?: (input: {
         stream: "stderr" | "stdout";
         text: string;
      }) => void;
      pid?: number;
   }
): Promise<RunResult> {
   const paths = buildRunPaths(preparedRun.runDir);
   const child = spawn(
      preparedRun.prepared.command,
      preparedRun.prepared.args,
      {
         cwd: preparedRun.prepared.cwd,
         env: preparedRun.prepared.env,
         stdio: "pipe"
      }
   );
   const completionPromise = waitForChildCompletion(child);
   const heartbeatPid =
      typeof options?.pid === "number"
         ? options.pid
         : typeof child.pid === "number"
           ? child.pid
           : undefined;

   await writeRunningState({
      agent: preparedRun.agent,
      cwd: preparedRun.runCwd,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      mode: preparedRun.mode,
      ...(typeof heartbeatPid === "number" ? { pid: heartbeatPid } : {}),
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });
   const stopHeartbeat = startRunHeartbeat({
      preparedRun,
      ...(typeof heartbeatPid === "number" ? { pid: heartbeatPid } : {})
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
      options?.mirrorOutput?.({
         stream: "stdout",
         text: value
      });
   });
   child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      stderrLogWriter.write(value);
      options?.mirrorOutput?.({
         stream: "stderr",
         text: value
      });
   });

   if (preparedRun.prepared.stdin !== undefined && child.stdin) {
      child.stdin.write(preparedRun.prepared.stdin);
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
      }, preparedRun.killGraceMs);
   }, preparedRun.timeoutMs);

   const completion = await completionPromise.finally(async () => {
      completed = true;
      clearTimeout(timer);

      if (killTimer) {
         clearTimeout(killTimer);
      }

      await stopHeartbeat();
      stdoutLogWriter.end();
      stderrLogWriter.end();
   });
   const endedAt = new Date().toISOString();

   if (completion.spawnError) {
      const record = createFailedRunRecord({
         agent: preparedRun.agent.name,
         agentPath: preparedRun.agent.path,
         agentScope: preparedRun.agent.scope,
         cwd: preparedRun.runCwd,
         endedAt,
         errorMessage: completion.spawnError.message,
         launch: preparedRun.launch,
         launchMode: preparedRun.launchMode,
         ...(typeof preparedRun.agent.model === "string"
            ? { model: preparedRun.agent.model }
            : {}),
         mode: preparedRun.mode,
         promptFile: paths.promptFile,
         provider: preparedRun.agent.provider,
         ...(typeof preparedRun.agent.reasoningEffort === "string"
            ? { reasoningEffort: preparedRun.agent.reasoningEffort }
            : {}),
         runDir: preparedRun.runDir,
         runId: preparedRun.runId,
         startedAt: preparedRun.startedAt,
         ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
         ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
      });

      await persistResult(record, paths.runFile);
      return toRunResult(record);
   }

   const adapter = getAdapterForProvider(preparedRun.agent.provider);
   const record = await adapter.parseCompletedRun({
      agent: preparedRun.agent,
      cwd: preparedRun.runCwd,
      endedAt,
      exitCode: completion.exitCode,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      mode: preparedRun.mode,
      promptFile: paths.promptFile,
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      signal: completion.signal,
      startedAt: preparedRun.startedAt,
      stderr,
      ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
      stdout,
      ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
   });
   const finalRecord = timedOut
      ? {
           ...record,
           agentPath: preparedRun.agent.path,
           agentScope: preparedRun.agent.scope,
           errorMessage: "Execution timed out.",
           launchMode: preparedRun.launchMode,
           status: "error" as const
        }
      : {
           ...record,
           agentPath: preparedRun.agent.path,
           agentScope: preparedRun.agent.scope,
           launchMode: preparedRun.launchMode
        };

   await persistResult(finalRecord, paths.runFile);

   return toRunResult(finalRecord);
}

function buildRelaunchArgs(runId: string): string[] {
   const cliEntrypoint = process.argv[1];

   if (typeof cliEntrypoint !== "string" || cliEntrypoint.length === 0) {
      throw new Error("Unable to resolve the current CLI entrypoint.");
   }

   return [...process.execArgv, cliEntrypoint, "internal-run", runId];
}

function toLaunchResult(input: {
   preparedRun: PreparedRun;
   pid?: number;
}): LaunchedRun {
   return {
      active: typeof input.pid === "number",
      agent: input.preparedRun.agent.name,
      agentPath: input.preparedRun.agent.path,
      agentScope: input.preparedRun.agent.scope,
      showCommand: `aiman sesh show ${input.preparedRun.runId}`,
      inspectCommand: `aiman sesh inspect ${input.preparedRun.runId}`,
      launchMode: "detached",
      logsCommand: `aiman sesh logs ${input.preparedRun.runId} -f`,
      mode: input.preparedRun.mode,
      ...(typeof input.pid === "number" ? { pid: input.pid } : {}),
      provider: input.preparedRun.agent.provider,
      rights: formatRunRights(
         input.preparedRun.agent.provider,
         input.preparedRun.mode
      ),
      runId: input.preparedRun.runId,
      startedAt: input.preparedRun.startedAt,
      status: "running"
   };
}

export async function launchRun(input: RunAgentInput): Promise<LaunchedRun> {
   const preparedRun = await prepareRun(input, "detached");
   let pid: number | undefined;

   try {
      const child = spawn(
         process.execPath,
         buildRelaunchArgs(preparedRun.runId),
         {
            cwd: preparedRun.runCwd,
            detached: true,
            env: process.env,
            stdio: "ignore"
         }
      );
      pid = await waitForDetachedLaunch(child);
      child.unref();
   } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await persistDetachedLaunchFailure(preparedRun, message);
      throw new UserError(
         `Detached run "${preparedRun.runId}" could not be launched: ${message}`
      );
   }

   input.onRunStarted?.({
      agent: preparedRun.agent.name,
      agentPath: preparedRun.agent.path,
      agentScope: preparedRun.agent.scope,
      provider: preparedRun.agent.provider,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   await writeRunningState({
      agent: preparedRun.agent,
      cwd: preparedRun.runCwd,
      heartbeatAt: new Date().toISOString(),
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      mode: preparedRun.mode,
      onlyIfRunning: true,
      ...(typeof pid === "number" ? { pid } : {}),
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   return toLaunchResult({
      preparedRun,
      ...(typeof pid === "number" ? { pid } : {})
   });
}

export async function runAgent(input: RunAgentInput): Promise<RunResult> {
   const preparedRun = await prepareRun(input, "foreground");

   input.onRunStarted?.({
      agent: preparedRun.agent.name,
      agentPath: preparedRun.agent.path,
      agentScope: preparedRun.agent.scope,
      provider: preparedRun.agent.provider,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   return executePreparedRun(preparedRun, {
      pid: process.pid
   });
}

export async function runDetachedWorker(runId: string): Promise<RunResult> {
   const preparedRun = await loadPreparedRun(runId);

   return executePreparedRun(preparedRun, {
      pid: process.pid
   });
}

export async function listRuns(
   options?: RunListOptions
): Promise<RunInspection[]> {
   return listRunDetails(options);
}

export { readRunDetails, readRunLog, toRunResult };
