import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError } from "./errors.js";
import { resolveCommandLaunch } from "./executables.js";
import {
   ensureProjectDirectories,
   getProjectPaths,
   resolveRunCwd
} from "./paths.js";
import { loadProfileDefinition } from "./profiles.js";
import { loadProjectContext } from "./project-context.js";
import { formatRunRights } from "./provider-capabilities.js";
import { buildPrompt } from "./providers/shared.js";
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
import { resolveSkillsForRun } from "./skills.js";
import type {
   LaunchMode,
   LaunchedRun,
   PreparedInvocation,
   PromptTransport,
   ProfileScope,
   ProviderId,
   RunLaunchSnapshot,
   RunInspection,
   RunListOptions,
   RunMode,
   RunResult,
   ScopedProfileDefinition
} from "./types.js";

const defaultTimeoutMs = 5 * 60 * 1000;
const defaultKillGraceMs = 1 * 1000;
const promptArgumentPlaceholder = "@prompt.md";
const runHeartbeatIntervalMs = 1000;
const stopPollIntervalMs = 100;
const stopWaitSlackMs = 2 * 1000;

type RunAgentInput = {
   agentName?: string;
   agentScope?: ProfileScope;
   mode?: RunMode;
   profileName?: string;
   profileScope?: ProfileScope;
   cwd?: string;
   killGraceMs?: number;
   selectedSkillNames?: string[];
   onRunStarted?: (input: {
      profile: string;
      profilePath: string;
      profileScope: ProfileScope;
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
   mode: RunMode;
   prepared: PreparedInvocation;
   projectRoot: string;
   runCwd: string;
   runDir: string;
   runId: string;
   selectedSkillNames: string[];
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
   mode: RunMode;
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
      cwd: input.cwd,
      ...(typeof input.heartbeatAt === "string"
         ? { heartbeatAt: input.heartbeatAt }
         : { heartbeatAt: new Date().toISOString() }),
      launch: input.launch,
      launchMode: input.launchMode,
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      mode: input.mode,
      paths,
      profile: input.profile.name,
      profilePath: input.profile.path,
      profileScope: input.profile.scope,
      projectRoot: input.projectRoot,
      provider: input.profile.provider,
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
         [
            "/PID",
            String(pid),
            "/T",
            ...(force ? ["/F"] : [])
         ],
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
               mode: input.preparedRun.mode,
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
      mode: preparedRun.mode,
      profile: preparedRun.profile.name,
      profilePath: preparedRun.profile.path,
      profileScope: preparedRun.profile.scope,
      promptFile: paths.promptFile,
      projectRoot: preparedRun.projectRoot,
      provider: preparedRun.profile.provider,
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
   profile: ScopedProfileDefinition;
   killGraceMs: number;
   launchMode: LaunchMode;
   mode: RunMode;
   prepared: PreparedInvocation;
   projectContextPath?: string;
   skills: string[];
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
      command: input.prepared.command,
      ...(typeof input.projectContextPath === "string"
         ? { contextFiles: [input.projectContextPath] }
         : {}),
      cwd: input.prepared.cwd,
      envKeys: Object.keys(input.prepared.env).sort(),
      killGraceMs: input.killGraceMs,
      launchMode: input.launchMode,
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      mode: input.mode,
      permissions: input.mode,
      profileDigest: hashText(profileSource),
      profileName: input.profile.name,
      profilePath: input.profile.path,
      profileScope: input.profile.scope,
      ...(typeof input.projectContextPath === "string"
         ? { projectContextPath: input.projectContextPath }
         : {}),
      promptDigest: hashText(input.prepared.renderedPrompt),
      promptTransport: input.prepared.promptTransport,
      provider: input.profile.provider,
      skills: input.skills,
      task: input.task,
      timeoutMs: input.timeoutMs
   };
}

async function resolveProfileForRun(input: {
   profileName: string;
   profileScope?: ProfileScope;
}): Promise<ScopedProfileDefinition> {
   return loadProfileDefinition(
      getProjectPaths(),
      input.profileName,
      input.profileScope
   );
}

async function prepareRun(
   input: RunAgentInput,
   launchMode: LaunchMode
): Promise<PreparedRun> {
   const projectPaths = getProjectPaths();
   await ensureProjectDirectories(projectPaths);
   const profileName = input.profileName ?? input.agentName;

   if (typeof profileName !== "string" || profileName.trim().length === 0) {
      throw new UserError("Profile name is required.");
   }

   const profile = await resolveProfileForRun({
      profileName,
      ...(input.profileScope !== undefined
         ? { profileScope: input.profileScope }
         : input.agentScope !== undefined
           ? { profileScope: input.agentScope }
         : {})
   });
   const runId = createRunId(profile.name);
   const runDir = path.join(projectPaths.runsDir, runId);
   const runCwd = resolveRunCwd(projectPaths.projectRoot, input.cwd);
   const startedAt = new Date().toISOString();
   const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
   const killGraceMs = input.killGraceMs ?? defaultKillGraceMs;
   const mode = input.mode ?? profile.mode ?? profile.permissions ?? "safe";

   await mkdir(runDir, { recursive: true });
   const paths = buildRunPaths(runDir);
   const projectContext = await loadProjectContext(projectPaths.projectRoot);
   const skillSelection = await resolveSkillsForRun(projectPaths, {
      profile,
      ...(input.selectedSkillNames !== undefined
         ? { selectedSkillNames: input.selectedSkillNames }
         : {}),
      task: input.task
   });
   const renderedPrompt = buildPrompt(profile, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      mode,
      ...(projectContext !== undefined ? { projectContext } : {}),
      runFile: paths.runFile,
      runId,
      skills: skillSelection.active,
      task: input.task
   });
   const adapter = getAdapterForProvider(profile.provider);
   const prepared = await adapter.prepare(profile, {
      artifactsDir: paths.artifactsDir,
      cwd: runCwd,
      mode,
      promptFile: paths.promptFile,
      ...(projectContext !== undefined ? { projectContext } : {}),
      renderedPrompt,
      runFile: paths.runFile,
      runId,
      skills: skillSelection.active,
      task: input.task
   });
   const launch = await buildLaunchSnapshot({
      killGraceMs,
      launchMode,
      mode,
      prepared,
      profile,
      ...(projectContext !== undefined
         ? { projectContextPath: projectContext.path }
         : {}),
      skills: skillSelection.active.map((skill) => skill.name),
      task: input.task,
      timeoutMs
   });

   if (prepared.supportFiles !== undefined) {
      for (const supportFile of prepared.supportFiles) {
         await writeFile(supportFile.path, supportFile.content, "utf8");
      }
   }

   await writeFile(paths.promptFile, prepared.renderedPrompt, "utf8");
   await writeRunningState({
      profile,
      launchMode,
      cwd: runCwd,
      launch,
      mode,
      projectRoot: projectPaths.projectRoot,
      runDir,
      runId,
      startedAt
   });

   return {
      killGraceMs,
      launch,
      launchMode,
      mode,
      prepared,
      profile,
      projectRoot: projectPaths.projectRoot,
      runCwd,
      runDir,
      runId,
      selectedSkillNames: skillSelection.active.map((skill) => skill.name),
      startedAt,
      timeoutMs
   };
}

async function loadPreparedRun(runId: string): Promise<PreparedRun> {
   const run = await readRunDetails(runId);

   if (run.status !== "running") {
      throw new UserError(`Run "${runId}" is already complete.`);
   }

   const renderedPrompt = await readFile(run.paths.promptFile, "utf8");

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
      description: "",
      id: profileName,
      ...(profilePath.startsWith("<builtin>/")
         ? { isBuiltIn: true }
         : {}),
      model: run.launch.model,
      mode: run.mode,
      name: profileName,
      path: profilePath,
      permissions: run.mode,
      provider: run.launch.provider,
      scope: profileScope,
      ...(run.launch.skills.length > 0 ? { skills: run.launch.skills } : {})
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
      mode: run.mode,
      profile,
      projectRoot: run.projectRoot,
      runCwd: run.launch.cwd,
      runDir: run.paths.runDir,
      runId,
      selectedSkillNames: run.launch.skills,
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
      mode: preparedRun.mode,
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
         mode: preparedRun.mode,
         profile: preparedRun.profile.name,
         profilePath: preparedRun.profile.path,
         profileScope: preparedRun.profile.scope,
         promptFile: paths.promptFile,
         projectRoot: preparedRun.projectRoot,
         provider: preparedRun.profile.provider,
         runDir: preparedRun.runDir,
         runId: preparedRun.runId,
         startedAt: preparedRun.startedAt,
         ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
         ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
      });

      await persistResult(record, paths.runFile);
      return toRunResult(record);
   }

   const adapter = getAdapterForProvider(preparedRun.profile.provider);
   const record = await adapter.parseCompletedRun({
      cwd: preparedRun.runCwd,
      endedAt,
      exitCode: completion.exitCode,
      launch: preparedRun.launch,
      launchMode: preparedRun.launchMode,
      mode: preparedRun.mode,
      profile: preparedRun.profile,
      promptFile: paths.promptFile,
      projectRoot: preparedRun.projectRoot,
      runDir: preparedRun.runDir,
      runId: preparedRun.runId,
      signal: completion.signal ?? (stopRequested ? "SIGTERM" : null),
      startedAt: preparedRun.startedAt,
      stderr,
      ...(stderr.length > 0 ? { stderrLog: paths.stderrLog } : {}),
      stdout,
      ...(stdout.length > 0 ? { stdoutLog: paths.stdoutLog } : {})
   });
   const finalRecord = timedOut
      ? {
           ...record,
           errorMessage: "Execution timed out.",
           launchMode: preparedRun.launchMode,
           profilePath: preparedRun.profile.path,
           profileScope: preparedRun.profile.scope,
           projectRoot: preparedRun.projectRoot,
           status: "error" as const
        }
      : {
           ...record,
           launchMode: preparedRun.launchMode,
           profilePath: preparedRun.profile.path,
           profileScope: preparedRun.profile.scope,
           projectRoot: preparedRun.projectRoot
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
      agent: input.preparedRun.profile.name,
      agentPath: input.preparedRun.profile.path,
      agentScope: input.preparedRun.profile.scope,
      inspectCommand: `aiman run inspect ${input.preparedRun.runId}`,
      launchMode: "detached",
      logsCommand: `aiman run logs ${input.preparedRun.runId} -f`,
      mode: input.preparedRun.mode,
      ...(typeof input.pid === "number" ? { pid: input.pid } : {}),
      profile: input.preparedRun.profile.name,
      profilePath: input.preparedRun.profile.path,
      profileScope: input.preparedRun.profile.scope,
      projectRoot: input.preparedRun.projectRoot,
      provider: input.preparedRun.profile.provider,
      rights: formatRunRights(
         input.preparedRun.profile.provider,
         input.preparedRun.mode
      ),
      runId: input.preparedRun.runId,
      showCommand: `aiman run show ${input.preparedRun.runId}`,
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
      profile: preparedRun.profile.name,
      profilePath: preparedRun.profile.path,
      profileScope: preparedRun.profile.scope,
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
      mode: preparedRun.mode,
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
      profile: preparedRun.profile.name,
      profilePath: preparedRun.profile.path,
      profileScope: preparedRun.profile.scope,
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

   await writeFile(run.paths.stopRequestedFile, new Date().toISOString(), "utf8");

   return waitForRunStop(runId, run.launch.killGraceMs + stopWaitSlackMs);
}

export { readRunDetails, readRunLog, toRunResult };
