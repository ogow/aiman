import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { getProjectPaths } from "./paths.js";
import { formatRunRights } from "./provider-capabilities.js";
import {
   listRunIndexEntries,
   readRunIndexEntry,
   upsertRunIndexEntry
} from "./run-index.js";
import { readMarkdownDocument, writeMarkdownDocument } from "./run-doc.js";
import type {
   LaunchMode,
   MarkdownDocument,
   MarkdownFrontmatter,
   MarkdownValue,
   PersistedRunRecord,
   ProviderId,
   PromptTransport,
   RunLaunchSnapshot,
   RunInspection,
   RunListOptions,
   RunMode,
   RunPaths,
   RunResult,
   RunStatus,
   StoredRunState,
   UsageStats
} from "./types.js";

type StoredRunPaths = RunPaths & {
   artifactsDir: string;
   runFile: string;
   stderrLog: string;
   stdoutLog: string;
};

const reservedRunFrontmatterKeys = new Set([
   "cwd",
   "durationMs",
   "endedAt",
   "errorMessage",
   "exitCode",
   "heartbeatAt",
   "launchMode",
   "launch",
   "model",
   "mode",
   "pid",
   "profile",
   "profilePath",
   "profileScope",
   "provider",
   "projectRoot",
   "runId",
   "signal",
   "startedAt",
   "status",
   "usage"
]);

export function createRunId(agentName: string): string {
   const safeAgentName = agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

   return `${safeAgentName.length > 0 ? safeAgentName : "run"}-${randomUUID().slice(0, 8)}`;
}

export function buildRunPaths(runDir: string): StoredRunPaths {
   return {
      artifactsDir: path.join(runDir, "artifacts"),
      promptFile: path.join(runDir, "prompt.md"),
      runFile: path.join(runDir, "run.md"),
      runDir,
      stopRequestedFile: path.join(runDir, ".stop-requested"),
      stderrLog: path.join(runDir, "stderr.log"),
      stdoutLog: path.join(runDir, "stdout.log")
   };
}

function isProviderId(value: unknown): value is ProviderId {
   return value === "codex" || value === "gemini";
}

function isRunMode(value: unknown): value is RunMode {
   return value === "safe" || value === "yolo";
}

function isLaunchMode(value: unknown): value is LaunchMode {
   return value === "foreground" || value === "detached";
}

function isRunStatus(value: unknown): value is RunStatus {
   return value === "cancelled" || value === "error" || value === "success";
}

function getStringValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): string | undefined {
   const value = frontmatter[key];
   return typeof value === "string" ? value : undefined;
}

function getNumberValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): number | undefined {
   const value = frontmatter[key];
   return typeof value === "number" ? value : undefined;
}

function getNullableNumberValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): number | null | undefined {
   const value = frontmatter[key];

   if (value === null) {
      return null;
   }

   return typeof value === "number" ? value : undefined;
}

function getNullableStringValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): string | null | undefined {
   const value = frontmatter[key];

   if (value === null) {
      return null;
   }

   return typeof value === "string" ? value : undefined;
}

function getUsageStats(
   frontmatter: MarkdownFrontmatter
): UsageStats | undefined {
   const value = frontmatter.usage;

   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
   }

   const record = value as Record<string, unknown>;
   const inputTokens =
      typeof record.inputTokens === "number" ? record.inputTokens : undefined;
   const outputTokens =
      typeof record.outputTokens === "number" ? record.outputTokens : undefined;
   const totalTokens =
      typeof record.totalTokens === "number" ? record.totalTokens : undefined;

   if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      totalTokens === undefined
   ) {
      return undefined;
   }

   return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {})
   };
}

function getRecordValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): Record<string, MarkdownValue> | undefined {
   const value = frontmatter[key];

   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
   }

   return value as Record<string, MarkdownValue>;
}

function isPromptTransport(value: unknown): value is PromptTransport {
   return value === "arg" || value === "none" || value === "stdin";
}

function getStringList(value: unknown): string[] | undefined {
   if (!Array.isArray(value)) {
      return undefined;
   }

   return value.every((entry) => typeof entry === "string")
      ? (value as string[])
      : undefined;
}

function getLaunchSkillNames(value: unknown): string[] | undefined {
   const stringList = getStringList(value);

   if (stringList !== undefined) {
      return stringList;
   }

   if (!Array.isArray(value)) {
      return undefined;
   }

   const skillNames = value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
         return [];
      }

      const name = (entry as Record<string, unknown>).name;

      return typeof name === "string" ? [name] : [];
   });

   return skillNames.length === value.length ? skillNames : undefined;
}

function getLaunchSnapshot(
   frontmatter: MarkdownFrontmatter
): RunLaunchSnapshot | undefined {
   const launch = getRecordValue(frontmatter, "launch");

   if (!launch) {
      return undefined;
   }

   const args = launch.args;
   const command = launch.command;
   const cwd = launch.cwd;
   const envKeys = launch.envKeys;
   const killGraceMs = launch.killGraceMs;
   const launchMode = launch.launchMode;
   const model = launch.model;
   const mode = launch.mode;
   const profileDigest = launch.profileDigest;
   const profileName = launch.profileName;
   const profilePath = launch.profilePath;
   const profileScope = launch.profileScope;
   const projectContextPath = launch.projectContextPath;
   const promptDigest = launch.promptDigest;
   const promptTransport = launch.promptTransport;
   const provider = launch.provider;
   const skills = getLaunchSkillNames(launch.skills) ?? [];
   const task = launch.task;
   const timeoutMs = launch.timeoutMs;

   if (
      !Array.isArray(args) ||
      args.some((value) => typeof value !== "string") ||
      typeof command !== "string" ||
      typeof cwd !== "string" ||
      !Array.isArray(envKeys) ||
      envKeys.some((value) => typeof value !== "string") ||
      typeof killGraceMs !== "number" ||
      !isLaunchMode(launchMode) ||
      !isRunMode(mode) ||
      typeof profileDigest !== "string" ||
      typeof profileName !== "string" ||
      typeof profilePath !== "string" ||
      (profileScope !== "project" && profileScope !== "user") ||
      typeof promptDigest !== "string" ||
      !isPromptTransport(promptTransport) ||
      !isProviderId(provider) ||
      typeof timeoutMs !== "number"
   ) {
      return undefined;
   }

   if (model !== undefined && model !== null && typeof model !== "string") {
      return undefined;
   }

   if (
      projectContextPath !== undefined &&
      projectContextPath !== null &&
      typeof projectContextPath !== "string"
   ) {
      return undefined;
   }

   return {
      agentDigest:
         typeof launch.agentDigest === "string"
            ? launch.agentDigest
            : profileDigest,
      agentName:
         typeof launch.agentName === "string" ? launch.agentName : profileName,
      agentPath:
         typeof launch.agentPath === "string" ? launch.agentPath : profilePath,
      agentScope:
         launch.agentScope === "project" || launch.agentScope === "user"
            ? launch.agentScope
            : profileScope,
      args: args as string[],
      command,
      cwd,
      envKeys: envKeys as string[],
      killGraceMs,
      launchMode,
      ...(typeof model === "string" ? { model } : {}),
      mode,
      profileDigest,
      profileName,
      profilePath,
      profileScope,
      ...(typeof projectContextPath === "string" ? { projectContextPath } : {}),
      promptDigest,
      promptTransport,
      provider,
      skills,
      ...(typeof task === "string" ? { task } : {}),
      timeoutMs
   };
}

function pickAuthoredFrontmatter(
   frontmatter?: MarkdownFrontmatter
): MarkdownFrontmatter {
   if (!frontmatter) {
      return {};
   }

   return Object.fromEntries(
      Object.entries(frontmatter).filter(
         ([key]) => !reservedRunFrontmatterKeys.has(key)
      )
   );
}

function buildRunFrontmatter(
   value: PersistedRunRecord | StoredRunState
): MarkdownFrontmatter {
   const durationMs =
      "durationMs" in value && typeof value.durationMs === "number"
         ? value.durationMs
         : undefined;
   const pid =
      "pid" in value && typeof value.pid === "number" ? value.pid : undefined;

   return {
      runId: value.runId,
      status: value.status,
      ...(typeof value.profile === "string" ? { agent: value.profile } : {}),
      ...(typeof value.profileScope === "string"
         ? { agentScope: value.profileScope }
         : {}),
      ...(typeof value.profilePath === "string"
         ? { agentPath: value.profilePath }
         : {}),
      provider: value.provider,
      launchMode: value.launchMode,
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      ...(typeof value.launch.reasoningEffort === "string"
         ? { reasoningEffort: value.launch.reasoningEffort }
         : {}),
      mode: value.mode,
      permissions: value.mode,
      ...(typeof value.profile === "string" ? { profile: value.profile } : {}),
      ...(typeof value.profilePath === "string"
         ? { profilePath: value.profilePath }
         : {}),
      ...(typeof value.profileScope === "string"
         ? { profileScope: value.profileScope }
         : {}),
      cwd: value.cwd,
      projectRoot: value.projectRoot,
      startedAt: value.startedAt,
      ...("heartbeatAt" in value && typeof value.heartbeatAt === "string"
         ? { heartbeatAt: value.heartbeatAt }
         : {}),
      ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...("exitCode" in value ? { exitCode: value.exitCode } : {}),
      ...("signal" in value ? { signal: value.signal } : {}),
      ...(typeof value.errorMessage === "string"
         ? { errorMessage: value.errorMessage }
         : {}),
      launch: value.launch,
      ...(pid !== undefined ? { pid } : {}),
      ...(value.status !== "running" && "usage" in value && value.usage
         ? { usage: value.usage }
         : {})
   };
}

async function readExistingDocument(
   filePath: string,
   artifactsDir: string
): Promise<MarkdownDocument | undefined> {
   const document = await readMarkdownDocument(filePath, artifactsDir);

   return document.exists && document.parseError === undefined
      ? document
      : undefined;
}

function buildFinalBody(
   record: PersistedRunRecord,
   existing?: MarkdownDocument
): string {
   if (typeof existing?.body === "string" && existing.body.trim().length > 0) {
      return existing.body;
   }

   return record.finalText;
}

const runHeartbeatGraceMs = 10 * 1000;

function isPidActive(pid?: number): boolean {
   if (typeof pid !== "number") {
      return false;
   }

   try {
      process.kill(pid, 0);
      return true;
   } catch (error) {
      if (hasErrorCode(error, "EPERM")) {
         return true;
      }

      if (hasErrorCode(error, "ESRCH")) {
         return false;
      }

      throw error;
   }
}

function hasFreshHeartbeat(heartbeatAt?: string, nowMs = Date.now()): boolean {
   if (typeof heartbeatAt !== "string") {
      return false;
   }

   const heartbeatMs = Date.parse(heartbeatAt);

   return (
      Number.isFinite(heartbeatMs) &&
      Math.abs(nowMs - heartbeatMs) <= runHeartbeatGraceMs
   );
}

function toRunInspection(
   record: PersistedRunRecord | StoredRunState,
   document: MarkdownDocument
): RunInspection {
   const active =
      record.status === "running" &&
      isPidActive("pid" in record ? record.pid : undefined) &&
      hasFreshHeartbeat(
         "heartbeatAt" in record ? record.heartbeatAt : undefined
      );
   const warning =
      record.status === "running" && !active
         ? "Process exited before terminal record was written."
         : undefined;

   return {
      active,
      ...record,
      document,
      ...(typeof warning === "string" ? { warning } : {})
   };
}

function applyRunListOptions(
   runs: RunInspection[],
   options?: RunListOptions
): RunInspection[] {
   const filter = options?.filter ?? "all";
   const limit = options?.limit;
   const filtered =
      filter === "active"
         ? runs.filter((run) => run.active)
         : filter === "historic"
           ? runs.filter((run) => !run.active)
           : runs;

   return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

function parseStoredStateFromDocument(
   document: MarkdownDocument,
   paths: StoredRunPaths
): PersistedRunRecord | StoredRunState | undefined {
   const frontmatter = document.frontmatter;

   if (!frontmatter) {
      return undefined;
   }

   const runId = getStringValue(frontmatter, "runId");
   const profile = getStringValue(frontmatter, "profile");
   const profilePath = getStringValue(frontmatter, "profilePath");
   const profileScope = getStringValue(frontmatter, "profileScope");
   const provider = frontmatter.provider;
   const launchMode = frontmatter.launchMode;
   const model = getStringValue(frontmatter, "model");
   const mode = frontmatter.mode;
   const cwd = getStringValue(frontmatter, "cwd");
   const launch = getLaunchSnapshot(frontmatter);
   const heartbeatAt = getStringValue(frontmatter, "heartbeatAt");
   const projectRoot = getStringValue(frontmatter, "projectRoot");
   const startedAt = getStringValue(frontmatter, "startedAt");
   const status = frontmatter.status;

   if (
      typeof runId !== "string" ||
      typeof profile !== "string" ||
      (profileScope !== "project" && profileScope !== "user") ||
      typeof profilePath !== "string" ||
      !isProviderId(provider) ||
      !isLaunchMode(launchMode) ||
      !isRunMode(mode) ||
      typeof cwd !== "string" ||
      typeof projectRoot !== "string" ||
      launch === undefined ||
      typeof startedAt !== "string" ||
      typeof status !== "string"
   ) {
      return undefined;
   }

   if (status === "running") {
      const endedAt = getStringValue(frontmatter, "endedAt");
      const errorMessage = getStringValue(frontmatter, "errorMessage");
      const pid = getNumberValue(frontmatter, "pid");

      return {
         cwd,
         ...(typeof endedAt === "string" ? { endedAt } : {}),
         ...(typeof errorMessage === "string" ? { errorMessage } : {}),
         ...(typeof heartbeatAt === "string" ? { heartbeatAt } : {}),
         launch,
         launchMode,
         ...(typeof model === "string" ? { model } : {}),
         mode,
         ...(typeof pid === "number" ? { pid } : {}),
         paths,
         profile,
         profilePath,
         profileScope,
         projectRoot,
         provider,
         runId,
         startedAt,
         status
      };
   }

   if (!isRunStatus(status)) {
      return undefined;
   }

   const endedAt = getStringValue(frontmatter, "endedAt");
   const durationMs = getNumberValue(frontmatter, "durationMs");
   const exitCode = getNullableNumberValue(frontmatter, "exitCode");
   const errorMessage = getStringValue(frontmatter, "errorMessage");
   const signal = getNullableStringValue(frontmatter, "signal");
   const usage = getUsageStats(frontmatter);

   if (
      typeof endedAt !== "string" ||
      typeof durationMs !== "number" ||
      exitCode === undefined ||
      signal === undefined
   ) {
      return undefined;
   }

   return {
      cwd,
      durationMs,
      endedAt,
      ...(typeof errorMessage === "string" ? { errorMessage } : {}),
      exitCode,
      finalText: document.body?.trimEnd() ?? "",
      launch,
      launchMode,
      ...(typeof model === "string" ? { model } : {}),
      mode,
      paths,
      profile,
      profilePath,
      profileScope,
      projectRoot,
      provider,
      runId,
      signal,
      startedAt,
      status,
      ...(usage ? { usage } : {})
   };
}

export function createFailedRunRecord(input: {
   cwd: string;
   endedAt: string;
   errorMessage: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   model?: string;
   mode: RunMode;
   profile: string;
   profilePath: string;
   profileScope: "project" | "user";
   promptFile: string;
   projectRoot: string;
   provider: PersistedRunRecord["provider"];
   runDir: string;
   runId: string;
   startedAt: string;
   stderrLog?: string;
   stdoutLog?: string;
}): PersistedRunRecord {
   return {
      agent: input.profile,
      agentPath: input.profilePath,
      agentScope: input.profileScope,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      errorMessage: input.errorMessage,
      exitCode: null,
      finalText: "",
      launch: input.launch,
      launchMode: input.launchMode,
      ...(typeof input.model === "string" ? { model: input.model } : {}),
      mode: input.mode,
      paths: {
         artifactsDir: path.join(input.runDir, "artifacts"),
         promptFile: input.promptFile,
         runFile: path.join(input.runDir, "run.md"),
         runDir: input.runDir,
         stopRequestedFile: path.join(input.runDir, ".stop-requested"),
         ...(typeof input.stderrLog === "string"
            ? { stderrLog: input.stderrLog }
            : {}),
         ...(typeof input.stdoutLog === "string"
            ? { stdoutLog: input.stdoutLog }
            : {})
      },
      profile: input.profile,
      profilePath: input.profilePath,
      profileScope: input.profileScope,
      projectRoot: input.projectRoot,
      provider: input.provider,
      runId: input.runId,
      signal: null,
      startedAt: input.startedAt,
      status: "error"
   };
}

export function toRunResult(record: PersistedRunRecord): RunResult {
   return {
      ...(typeof record.profile === "string" ? { agent: record.profile } : {}),
      ...(typeof record.profilePath === "string"
         ? { agentPath: record.profilePath }
         : {}),
      ...(typeof record.profileScope === "string"
         ? { agentScope: record.profileScope }
         : {}),
      finalText: record.finalText,
      launchMode: record.launchMode,
      mode: record.mode,
      ...(typeof record.profile === "string"
         ? { profile: record.profile }
         : {}),
      ...(typeof record.profilePath === "string"
         ? { profilePath: record.profilePath }
         : {}),
      ...(typeof record.profileScope === "string"
         ? { profileScope: record.profileScope }
         : {}),
      projectRoot: record.projectRoot,
      provider: record.provider,
      rights: formatRunRights(record.provider, record.mode),
      runId: record.runId,
      runPath: record.paths.runFile,
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
   const existing = await readExistingDocument(
      filePath,
      value.paths.artifactsDir
   );

   await writeMarkdownDocument({
      body: existing?.body ?? "",
      filePath,
      frontmatter: {
         ...buildRunFrontmatter(value),
         ...pickAuthoredFrontmatter(existing?.frontmatter)
      }
   });
   await upsertRunIndexEntry(value);
}

export async function writeRunStateIfRunning(
   filePath: string,
   value: StoredRunState
): Promise<boolean> {
   const existing = await readExistingDocument(
      filePath,
      value.paths.artifactsDir
   );
   const currentStatus = existing?.frontmatter?.status;

   if (typeof currentStatus === "string" && currentStatus !== "running") {
      return false;
   }

   await writeMarkdownDocument({
      body: existing?.body ?? "",
      filePath,
      frontmatter: {
         ...buildRunFrontmatter(value),
         ...pickAuthoredFrontmatter(existing?.frontmatter)
      }
   });
   await upsertRunIndexEntry(value);

   return true;
}

export async function persistResult(
   record: PersistedRunRecord,
   runFile: string
): Promise<void> {
   const existing = await readExistingDocument(
      runFile,
      record.paths.artifactsDir
   );

   await writeMarkdownDocument({
      body: buildFinalBody(record, existing),
      filePath: runFile,
      frontmatter: {
         ...buildRunFrontmatter(record),
         ...pickAuthoredFrontmatter(existing?.frontmatter)
      }
   });
   await upsertRunIndexEntry(record);
}

async function resolveRunPaths(runId: string): Promise<StoredRunPaths> {
   const entry = await readRunIndexEntry(runId);

   if (entry !== undefined) {
      return buildRunPaths(entry.runDir);
   }

   const projectPaths = getProjectPaths();
   return buildRunPaths(path.join(projectPaths.runsDir, runId));
}

async function readRunDetailsFromPaths(
   runId: string,
   paths: StoredRunPaths
): Promise<RunInspection> {
   const document = await readMarkdownDocument(
      paths.runFile,
      paths.artifactsDir
   );

   if (!document.exists) {
      throw new UserError(`Run "${runId}" was not found.`);
   }

   if (document.parseError) {
      throw new UserError(
         `Run "${runId}" exists but its run.md could not be parsed: ${document.parseError}`
      );
   }

   const parsed = parseStoredStateFromDocument(document, paths);

   if (!parsed) {
      throw new UserError(
         `Run "${runId}" exists but its run.md is missing required fields.`
      );
   }

   return toRunInspection(parsed, document);
}

export async function readRunDetails(runId: string): Promise<RunInspection> {
   return readRunDetailsFromPaths(runId, await resolveRunPaths(runId));
}

export async function listRunDetails(
   options?: RunListOptions
): Promise<RunInspection[]> {
   const entries = await listRunIndexEntries();

   const runs = await Promise.all(
      entries.map(async (entry) => {
         try {
            return await readRunDetailsFromPaths(
               entry.runId,
               buildRunPaths(entry.runDir)
            );
         } catch (error) {
            if (error instanceof UserError) {
               return undefined;
            }

            throw error;
         }
      })
   );

   return applyRunListOptions(
      runs
         .filter((run): run is RunInspection => run !== undefined)
         .sort(
            (left, right) =>
               right.startedAt.localeCompare(left.startedAt) ||
               right.runId.localeCompare(left.runId)
         ),
      options
   );
}

export async function readRunLog(
   runId: string,
   stream: "prompt" | "run" | "stderr" | "stdout"
): Promise<string> {
   const paths = await resolveRunPaths(runId);
   const filePath =
      stream === "run"
         ? paths.runFile
         : stream === "prompt"
           ? paths.promptFile
           : stream === "stderr"
             ? paths.stderrLog
             : paths.stdoutLog;

   try {
      return await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         if (stream !== "run" && !(await runFileExists(paths.runFile))) {
            throw new UserError(`Run "${runId}" was not found.`);
         }

         throw new UserError(
            stream === "run"
               ? `No run file exists for run "${runId}".`
               : stream === "prompt"
                 ? `No prompt file exists for run "${runId}".`
                 : `No ${stream} log exists for run "${runId}".`
         );
      }

      throw error;
   }
}

async function runFileExists(filePath: string): Promise<boolean> {
   try {
      await readFile(filePath, "utf8");
      return true;
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return false;
      }

      throw error;
   }
}
