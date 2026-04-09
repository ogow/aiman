import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { loadAimanConfig } from "./config.js";
import { UserError } from "../lib/errors.js";
import { resolveCommandLaunch } from "./executables.js";
import {
   ensureProjectDirectories,
   getProjectPaths,
   resolveRunCwd
} from "../lib/paths.js";
import { loadAgentDefinition } from "../lib/agents.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import { finalizeRunRecord, renderAgentPrompt } from "./providers/runtime.js";
import {
   buildRunDirectory,
   buildRunPaths,
   createFailedRunRecord,
   createRunId,
   listRunDetails,
   persistRunRecord,
   readRunDetails,
   readRunLog,
   toRunResult,
   writeRunState,
   writeRunStateIfRunning
} from "./run-records.js";
import { getAdapterForProvider } from "./providers/index.js";
import type {
   LaunchMode,
   LaunchedRun,
   PreparedInvocation,
   PromptTransport,
   ProfileScope,
   ProviderId,
   ResultArtifact,
   RunLaunchSnapshot,
   RunInspection,
   RunListOptions,
   RunResult,
   ScopedProfileDefinition
} from "../lib/types.js";

const defaultRunTimeoutMs = 5 * 60 * 1000;
const defaultKillGraceMs = 1 * 1000;
const promptArgumentPlaceholder = "@prompt.md";
const runHeartbeatIntervalMs = 1000;
const stopPollIntervalMs = 100;
const stopWaitSlackMs = 2 * 1000;

type RunAgentInput = {
   agentName?: string;
   agentScope?: ProfileScope;
   profileName?: string;
   profileScope?: ProfileScope;
   projectRoot?: string;
   cwd?: string;
   killGraceMs?: number;
   onRunStarted?: (input: {
      agent: string;
      agentPath: string;
      agentScope: ProfileScope;
      provider: ProviderId;
      runId: string;
      startedAt: string;
   }) => void;
   onRunOutput?: (input: { stream: "stderr" | "stdout"; text: string }) => void;
   task: string;
   timeoutMs?: number;
};

type PreparedRun = {
   profile: ScopedProfileDefinition;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   prepared: PreparedInvocation;
   projectRoot: string;
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
   profile: ScopedProfileDefinition;
   cwd: string;
   heartbeatAt?: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   onlyIfRunning?: boolean;
   pid?: number;
   projectRoot: string;
   runDir: string;
   runId: string;
   startedAt: string;
}): Promise<void> {
   const paths = buildRunPaths(input.runDir);
   const nextState = {
      agent: input.profile.name,
      agentPath: input.profile.path,
      agentScope: input.profile.scope,
      artifacts: [],
      cwd: input.cwd,
      ...(typeof input.heartbeatAt === "string"
         ? { heartbeatAt: input.heartbeatAt }
         : { heartbeatAt: new Date().toISOString() }),
      launch: input.launch,
      launchMode: input.launchMode,
      logs: {
         stderr: "stderr.log",
         stdout: "stdout.log"
      },
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      projectRoot: input.projectRoot,
      provider: input.profile.provider,
      resultMode: input.profile.resultMode,
      runId: input.runId,
      schemaVersion: 1 as const,
      startedAt: input.startedAt,
      status: "running",
      ...(typeof input.launch.task === "string"
         ? { task: input.launch.task }
         : {}),
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

function delay(durationMs: number): Promise<void> {
   return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
   });
}

async function killWindowsProcessTree(
   pid: number,
   force: boolean
): Promise<void> {
   await new Promise<void>((resolve) => {
      const child = spawn(
         "taskkill",
         ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
         {
            stdio: "ignore",
            windowsHide: true
         }
      );

      child.once("error", () => {
         resolve();
      });
      child.once("close", () => {
         resolve();
      });
   });
}

function killPosixProcessGroup(pid: number, signal: NodeJS.Signals): void {
   try {
      process.kill(-pid, signal);
   } catch {}
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
               profile: input.preparedRun.profile,
               cwd: input.preparedRun.runCwd,
               heartbeatAt: new Date().toISOString(),
               launch: input.preparedRun.launch,
               launchMode: input.preparedRun.launchMode,
               ...(typeof input.pid === "number" ? { pid: input.pid } : {}),
               projectRoot: input.preparedRun.projectRoot,
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
      cwd: preparedRun.runCwd,
      endedAt: new Date().toISOString(),
      errorMessage,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      ...(typeof preparedRun.profile.model === "string"
         ? { model: preparedRun.profile.model }
         : {}),
      profile: preparedRun.profile.name,
      profilePath: preparedRun.profile.path,
      profileScope: preparedRun.profile.scope,
      projectRoot: preparedRun.projectRoot,
      provider: preparedRun.profile.provider,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   await persistRunRecord(record, paths.runFile);
}

function hashText(value: string): string {
   return createHash("sha256").update(value).digest("hex");
}

async function collectArtifactsFromDirectory(
   artifactsDir: string,
   currentDir = artifactsDir
): Promise<ResultArtifact[]> {
   const entries = await readdir(currentDir, { withFileTypes: true });
   const artifacts: ResultArtifact[] = [];

   for (const entry of entries) {
      const entryPath = `${currentDir}/${entry.name}`;

      if (entry.isDirectory()) {
         artifacts.push(
            ...(await collectArtifactsFromDirectory(artifactsDir, entryPath))
         );
         continue;
      }

      if (!entry.isFile()) {
         continue;
      }

      const resolvedPath = path.resolve(entryPath);
      const relativePath = path.relative(artifactsDir, resolvedPath);
      const stats = await stat(resolvedPath);

      artifacts.push({
         exists: true,
         path: relativePath,
         resolvedPath,
         summary: `${stats.size} bytes`
      });
   }

   return artifacts.sort((left, right) => left.path.localeCompare(right.path));
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
   contextFiles?: string[];
   profile: ScopedProfileDefinition;
   killGraceMs: number;
   launchMode: LaunchMode;
   prepared: PreparedInvocation;
   task: string;
   timeoutMs: number;
}): Promise<RunLaunchSnapshot> {
   const profileSource =
      input.profile.isBuiltIn === true
         ? input.profile.body
         : await readFile(input.profile.path, "utf8");

   return {
      agentDigest: hashText(profileSource),
      agentName: input.profile.name,
      agentPath: input.profile.path,
      agentScope: input.profile.scope,
      args: snapshotInvocationArgs(input.prepared),
      ...(input.profile.capabilities !== undefined &&
      input.profile.capabilities.length > 0
         ? { capabilities: input.profile.capabilities }
         : {}),
      command: input.prepared.command,
      ...(input.contextFiles !== undefined && input.contextFiles.length > 0
         ? { contextFiles: input.contextFiles }
         : {}),
      cwd: input.prepared.cwd,
      envKeys: Object.keys(input.prepared.env).sort(),
      killGraceMs: input.killGraceMs,
      launchMode: input.launchMode,
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      reasoningEffort: input.profile.reasoningEffort,
      profileDigest: hashText(profileSource),
      profileName: input.profile.name,
      profilePath: input.profile.path,
      profileScope: input.profile.scope,
      promptDigest: hashText(input.prepared.renderedPrompt),
      promptTransport: input.prepared.promptTransport,
      provider: input.profile.provider,
      resultMode: input.profile.resultMode,
      renderedPrompt: input.prepared.renderedPrompt,
      task: input.task,
      timeoutMs: input.timeoutMs
   };
}

async function resolveProfileForRun(input: {
   profileName: string;
   projectRoot?: string;
   profileScope?: ProfileScope;
}): Promise<ScopedProfileDefinition> {
   return loadAgentDefinition(
      getProjectPaths(input.projectRoot),
      input.profileName,
      input.profileScope
   );
}

async function prepareRun(
   input: RunAgentInput,
   launchMode: LaunchMode
): Promise<PreparedRun> {
   const projectPaths = getProjectPaths(input.projectRoot);
   await ensureProjectDirectories(projectPaths);
   const config = await loadAimanConfig(projectPaths);
   const profileName = input.profileName ?? input.agentName;

   if (typeof profileName !== "string" || profileName.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   const profile = await resolveProfileForRun({
      profileName,
      ...(input.projectRoot !== undefined
         ? { projectRoot: input.projectRoot }
         : {}),
      ...(input.profileScope !== undefined
         ? { profileScope: input.profileScope }
         : input.agentScope !== undefined
           ? { profileScope: input.agentScope }
           : {})
   });
   const startedAt = new Date().toISOString();
   const runId = createRunId(profile.name, startedAt);
   const runDir = buildRunDirectory(projectPaths.runsDir, runId, startedAt);
   const runCwd = resolveRunCwd(projectPaths.projectRoot, input.cwd);
   const timeoutMs = input.timeoutMs ?? defaultRunTimeoutMs;
   const killGraceMs = input.killGraceMs ?? defaultKillGraceMs;

   await mkdir(runDir, { recursive: true });
   const paths = buildRunPaths(runDir);
   await mkdir(paths.artifactsDir, { recursive: true });
   const renderedPrompt = renderAgentPrompt(profile, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      runFile: paths.runFile,
      runId,
      task: input.task
   });
   const adapter = getAdapterForProvider(profile.provider);
   const prepared = await adapter.prepare(profile, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      renderedPrompt,
      runFile: paths.runFile,
      runId,
      ...(config.contextFileNames !== undefined
         ? { contextFileNames: config.contextFileNames }
         : {}),
      task: input.task
   });
   const launch = await buildLaunchSnapshot({
      killGraceMs,
      launchMode,
      prepared,
      profile,
      task: input.task,
      ...(config.contextFileNames !== undefined
         ? { contextFiles: config.contextFileNames }
         : {}),
      timeoutMs
   });

   if (prepared.supportFiles !== undefined) {
      for (const supportFile of prepared.supportFiles) {
         await writeFile(supportFile.path, supportFile.content, "utf8");
      }
   }

   await writeRunningState({
      profile,
      launchMode,
      cwd: runCwd,
      launch,
      projectRoot: projectPaths.projectRoot,
      runDir,
      runId,
      startedAt
   });

   return {
      killGraceMs,
      launch,
      launchMode,
      prepared,
      profile,
      projectRoot: projectPaths.projectRoot,
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

   const renderedPrompt = run.launch.renderedPrompt;

   if (typeof run.launch.model !== "string" || run.launch.model.length === 0) {
      throw new UserError(
         `Run "${runId}" is missing its required launch model.`
      );
   }

   const profileName = run.launch.profileName ?? run.launch.agentName;
   const profilePath = run.launch.profilePath ?? run.launch.agentPath;
   const profileScope = run.launch.profileScope ?? run.launch.agentScope;

   if (
      typeof profileName !== "string" ||
      typeof profilePath !== "string" ||
      (profileScope !== "project" && profileScope !== "user")
   ) {
      throw new UserError(
         `Run "${runId}" is missing its required launch profile identity.`
      );
   }

   const profile: ScopedProfileDefinition = {
      body: renderedPrompt,
      ...(run.launch.capabilities !== undefined
         ? { capabilities: run.launch.capabilities }
         : {}),
      description: "",
      id: profileName,
      ...(profilePath.startsWith("<builtin>/") ? { isBuiltIn: true } : {}),
      model: run.launch.model,
      name: profileName,
      path: profilePath,
      provider: run.launch.provider,
      reasoningEffort: run.launch.reasoningEffort ?? "none",
      resultMode: run.launch.resultMode,
      scope: profileScope
   };

   return {
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
            paths: buildRunPaths(run.paths.runDir),
            runId
         }),
         promptTransport: run.launch.promptTransport,
         renderedPrompt,
         ...(run.launch.promptTransport === "stdin"
            ? { stdin: renderedPrompt }
            : {})
      },
      profile,
      projectRoot: run.projectRoot,
      runCwd: run.launch.cwd,
      runDir: run.paths.runDir,
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
      requestStopOnStart?: boolean;
   }
): Promise<RunResult> {
   const paths = buildRunPaths(preparedRun.runDir);
   const launch = await resolveCommandLaunch(
      preparedRun.prepared.command,
      preparedRun.prepared.args
   );
   const child = spawn(launch.command, launch.args, {
      cwd: preparedRun.prepared.cwd,
      detached: process.platform !== "win32",
      env: preparedRun.prepared.env,
      shell: launch.needsShell,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      stdio: "pipe"
   });
   const completionPromise = waitForChildCompletion(child);
   const heartbeatPid =
      typeof options?.pid === "number"
         ? options.pid
         : typeof child.pid === "number"
           ? child.pid
           : undefined;

   await writeRunningState({
      profile: preparedRun.profile,
      cwd: preparedRun.runCwd,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      ...(typeof heartbeatPid === "number" ? { pid: heartbeatPid } : {}),
      projectRoot: preparedRun.projectRoot,
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
   let stopRequested = options?.requestStopOnStart === true;
   let killTimer: NodeJS.Timeout | null = null;

   const requestChildStop = () => {
      if (completed) {
         return;
      }

      stopRequested = true;
      if (launch.usesCommandProcessor && process.platform === "win32") {
         if (typeof child.pid === "number") {
            void killWindowsProcessTree(child.pid, false);
         }
      } else if (process.platform !== "win32") {
         if (typeof child.pid === "number") {
            killPosixProcessGroup(child.pid, "SIGTERM");
         }
      } else {
         child.kill("SIGTERM");
      }

      if (killTimer !== null) {
         return;
      }

      killTimer = setTimeout(() => {
         if (!completed) {
            if (launch.usesCommandProcessor && process.platform === "win32") {
               if (typeof child.pid === "number") {
                  void killWindowsProcessTree(child.pid, true);
               }
            } else if (process.platform !== "win32") {
               if (typeof child.pid === "number") {
                  killPosixProcessGroup(child.pid, "SIGKILL");
               }
            } else {
               child.kill("SIGKILL");
            }
         }
      }, preparedRun.killGraceMs);
   };
   const handleProcessSignal = () => {
      requestChildStop();
   };

   process.on("SIGINT", handleProcessSignal);
   process.on("SIGTERM", handleProcessSignal);

   if (options?.requestStopOnStart === true) {
      requestChildStop();
   }

   const stopRequestInterval = setInterval(() => {
      void access(paths.stopRequestedFile)
         .then(() => {
            requestChildStop();
         })
         .catch(() => undefined);
   }, stopPollIntervalMs);

   stopRequestInterval.unref?.();

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

   const timer = setTimeout(() => {
      timedOut = true;
      requestChildStop();
   }, preparedRun.timeoutMs);

   const completion = await completionPromise.finally(async () => {
      completed = true;
      clearTimeout(timer);
      clearInterval(stopRequestInterval);
      process.off("SIGINT", handleProcessSignal);
      process.off("SIGTERM", handleProcessSignal);

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
         cwd: preparedRun.runCwd,
         endedAt,
         errorMessage: completion.spawnError.message,
         launch: preparedRun.launch,
         launchMode: preparedRun.launchMode,
         ...(typeof preparedRun.profile.model === "string"
            ? { model: preparedRun.profile.model }
            : {}),
         profile: preparedRun.profile.name,
         profilePath: preparedRun.profile.path,
         profileScope: preparedRun.profile.scope,
         projectRoot: preparedRun.projectRoot,
         provider: preparedRun.profile.provider,
         runId: preparedRun.runId,
         startedAt: preparedRun.startedAt
      });

      await persistRunRecord(record, paths.runFile);
      return toRunResult(record, paths);
   }

   const adapter = getAdapterForProvider(preparedRun.profile.provider);
   const providerCompletion = await adapter.parseCompletion({
      cwd: preparedRun.runCwd,
      endedAt,
      exitCode: completion.exitCode,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      profile: preparedRun.profile,
      projectRoot: preparedRun.projectRoot,
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      signal: completion.signal ?? (stopRequested ? "SIGTERM" : null),
      startedAt: preparedRun.startedAt,
      stderr,
      stdout
   });
   const artifacts = await collectArtifactsFromDirectory(paths.artifactsDir);
   const record = finalizeRunRecord({
      artifacts,
      completion: providerCompletion,
      cwd: preparedRun.runCwd,
      endedAt,
      exitCode: completion.exitCode,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      profile: preparedRun.profile,
      projectRoot: preparedRun.projectRoot,
      runId: preparedRun.runId,
      signal: completion.signal ?? (stopRequested ? "SIGTERM" : null),
      startedAt: preparedRun.startedAt,
      stderr
   });
   const finalRecord = timedOut
      ? {
           ...record,
           error: {
              message: "Execution timed out."
           },
           status: "error" as const
        }
      : record;

   await persistRunRecord(finalRecord, paths.runFile);

   return toRunResult(finalRecord, paths);
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
      agent: input.preparedRun.profile.name,
      agentPath: input.preparedRun.profile.path,
      agentScope: input.preparedRun.profile.scope,
      inspectCommand: `aiman runs inspect ${input.preparedRun.runId}`,
      launchMode: "detached",
      logsCommand: `aiman runs logs ${input.preparedRun.runId} -f`,
      ...(typeof input.pid === "number" ? { pid: input.pid } : {}),
      projectRoot: input.preparedRun.projectRoot,
      provider: input.preparedRun.profile.provider,
      rights: formatRunRights(input.preparedRun.profile.provider),
      runId: input.preparedRun.runId,
      showCommand: `aiman runs show ${input.preparedRun.runId}`,
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
      agent: preparedRun.profile.name,
      agentPath: preparedRun.profile.path,
      agentScope: preparedRun.profile.scope,
      provider: preparedRun.profile.provider,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   await writeRunningState({
      profile: preparedRun.profile,
      cwd: preparedRun.runCwd,
      heartbeatAt: new Date().toISOString(),
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      onlyIfRunning: true,
      ...(typeof pid === "number" ? { pid } : {}),
      projectRoot: preparedRun.projectRoot,
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
      agent: preparedRun.profile.name,
      agentPath: preparedRun.profile.path,
      agentScope: preparedRun.profile.scope,
      provider: preparedRun.profile.provider,
      runId: preparedRun.runId,
      startedAt: preparedRun.startedAt
   });

   return executePreparedRun(preparedRun, {
      ...(input.onRunOutput !== undefined
         ? { mirrorOutput: input.onRunOutput }
         : {}),
      pid: process.pid
   });
}

export async function runDetachedWorker(runId: string): Promise<RunResult> {
   let stopRequested = false;
   const handleProcessSignal = () => {
      stopRequested = true;
   };

   process.on("SIGINT", handleProcessSignal);
   process.on("SIGTERM", handleProcessSignal);

   try {
      const preparedRun = await loadPreparedRun(runId);

      return executePreparedRun(preparedRun, {
         pid: process.pid,
         requestStopOnStart: stopRequested
      });
   } finally {
      process.off("SIGINT", handleProcessSignal);
      process.off("SIGTERM", handleProcessSignal);
   }
}

export async function listRuns(
   options?: RunListOptions
): Promise<RunInspection[]> {
   return listRunDetails(options);
}

async function waitForRunStop(
   runId: string,
   timeoutMs: number
): Promise<RunInspection> {
   const deadline = Date.now() + timeoutMs;
   let run = await readRunDetails(runId);

   while (run.status === "running" && Date.now() < deadline) {
      await delay(stopPollIntervalMs);
      run = await readRunDetails(runId);
   }

   return run;
}

export async function stopRun(runId: string): Promise<RunInspection> {
   const run = await readRunDetails(runId);

   if (run.status !== "running" || run.active !== true) {
      throw new UserError(`Run "${runId}" is not active.`);
   }

   await writeFile(
      run.paths.stopRequestedFile,
      new Date().toISOString(),
      "utf8"
   );

   return waitForRunStop(runId, run.launch.killGraceMs + stopWaitSlackMs);
}

export { readRunDetails, readRunLog, toRunResult };
