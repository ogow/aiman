import { randomUUID } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "../lib/errors.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import { formatRunDay, getProjectPaths } from "../lib/paths.js";
import type {
   LaunchMode,
   PersistedRunRecord,
   ResultArtifact,
   RunInspection,
   RunListOptions,
   RunPaths,
   RunResult,
   RunStatus,
   TerminalRunStatus
} from "../lib/types.js";

type StoredRunPaths = RunPaths;

const runRecordSchemaVersion = 1;
const runHeartbeatGraceMs = 10 * 1000;

function normalizeAgentName(agentName: string): string {
   return agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
}

function formatRunTimestamp(isoTimestamp: string): string {
   return isoTimestamp
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")
      .replace("T", "T");
}

export function createRunId(
   agentName: string,
   startedAt = new Date().toISOString()
): string {
   const safeAgentName = normalizeAgentName(agentName);

   return `${formatRunTimestamp(startedAt)}-${safeAgentName.length > 0 ? safeAgentName : "run"}-${randomUUID().slice(0, 8)}`;
}

export function buildRunPaths(runDir: string): StoredRunPaths {
   return {
      artifactsDir: path.join(runDir, "artifacts"),
      runFile: path.join(runDir, "run.json"),
      runDir,
      stopRequestedFile: path.join(runDir, ".stop-requested"),
      stderrLog: path.join(runDir, "stderr.log"),
      stdoutLog: path.join(runDir, "stdout.log")
   };
}

export function buildRunDirectory(
   runsRoot: string,
   runId: string,
   startedAt: string
): string {
   return path.join(runsRoot, formatRunDay(startedAt), runId);
}

function isTerminalStatus(status: RunStatus): status is TerminalRunStatus {
   return status === "cancelled" || status === "error" || status === "success";
}

function isPersistedRunRecord(value: unknown): value is PersistedRunRecord {
   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
   }

   const record = value as Record<string, unknown>;

   return (
      record.schemaVersion === runRecordSchemaVersion &&
      typeof record.runId === "string" &&
      typeof record.status === "string" &&
      typeof record.agent === "string" &&
      typeof record.agentPath === "string" &&
      (record.agentScope === "project" || record.agentScope === "user") &&
      typeof record.cwd === "string" &&
      typeof record.projectRoot === "string" &&
      typeof record.provider === "string" &&
      typeof record.startedAt === "string" &&
      typeof record.launch === "object" &&
      record.launch !== null &&
      typeof record.logs === "object" &&
      record.logs !== null &&
      Array.isArray(record.artifacts)
   );
}

function validateRelativePath(
   relativePath: string,
   rootDir: string
): string | undefined {
   const resolvedPath = path.resolve(rootDir, relativePath);
   const relativeResolvedPath = path.relative(rootDir, resolvedPath);

   if (
      relativeResolvedPath.startsWith("..") ||
      path.isAbsolute(relativeResolvedPath)
   ) {
      return undefined;
   }

   return resolvedPath;
}

async function populateArtifactState(
   artifacts: ResultArtifact[],
   artifactsDir: string
): Promise<ResultArtifact[]> {
   return Promise.all(
      artifacts.flatMap(async (artifact) => {
         const resolvedPath = validateRelativePath(artifact.path, artifactsDir);

         if (resolvedPath === undefined) {
            return [];
         }

         try {
            await stat(resolvedPath);
            return [
               {
                  ...artifact,
                  exists: true,
                  resolvedPath
               }
            ];
         } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
               return [
                  {
                     ...artifact,
                     exists: false,
                     resolvedPath
                  }
               ];
            }

            throw error;
         }
      })
   ).then((entries) => entries.flat());
}

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

async function enrichRunRecord(
   record: PersistedRunRecord,
   paths: StoredRunPaths
): Promise<RunInspection> {
   const artifacts = await populateArtifactState(
      record.artifacts,
      paths.artifactsDir
   );
   const active =
      record.status === "running" &&
      isPidActive(record.pid) &&
      hasFreshHeartbeat(record.heartbeatAt);
   const warning =
      record.status === "running" && !active
         ? "Process exited before terminal record was written."
         : undefined;

   return {
      ...record,
      active,
      artifacts,
      paths,
      ...(typeof warning === "string" ? { warning } : {})
   };
}

function serializeRunRecord(record: PersistedRunRecord): string {
   return `${JSON.stringify(record, null, 2)}\n`;
}

async function readPersistedRunFile(
   filePath: string
): Promise<PersistedRunRecord> {
   let content: string;

   try {
      content = await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         throw new UserError(`Run file "${filePath}" was not found.`);
      }

      throw error;
   }

   let parsed: unknown;

   try {
      parsed = JSON.parse(content) as unknown;
   } catch (error) {
      throw new UserError(
         `Run file "${filePath}" could not be parsed: ${error instanceof Error ? error.message : String(error)}`
      );
   }

   if (!isPersistedRunRecord(parsed)) {
      throw new UserError(`Run file "${filePath}" is missing required fields.`);
   }

   return parsed;
}

async function listDirectories(directoryPath: string): Promise<string[]> {
   try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      return entries
         .filter((entry) => entry.isDirectory())
         .map((entry) => entry.name)
         .sort((left, right) => right.localeCompare(left));
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

async function findRunPaths(runId: string): Promise<StoredRunPaths> {
   const { runsDir } = getProjectPaths();
   const dayDirectories = await listDirectories(runsDir);

   for (const dayDirectory of dayDirectories) {
      const runDir = path.join(runsDir, dayDirectory, runId);

      try {
         const stats = await stat(runDir);
         if (stats.isDirectory()) {
            return buildRunPaths(runDir);
         }
      } catch (error) {
         if (hasErrorCode(error, "ENOENT")) {
            continue;
         }

         throw error;
      }
   }

   throw new UserError(`Run "${runId}" was not found.`);
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

export function createFailedRunRecord(input: {
   cwd: string;
   endedAt: string;
   errorMessage: string;
   launch: PersistedRunRecord["launch"];
   launchMode: LaunchMode;
   model?: string;
   profile: string;
   profilePath: string;
   profileScope: "project" | "user";
   projectRoot: string;
   provider: PersistedRunRecord["provider"];
   runId: string;
   startedAt: string;
}): PersistedRunRecord {
   return {
      agent: input.profile,
      agentPath: input.profilePath,
      agentScope: input.profileScope,
      artifacts: [],
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      error: {
         message: input.errorMessage
      },
      exitCode: null,
      launch: input.launch,
      launchMode: input.launchMode,
      logs: {
         stderr: "stderr.log",
         stdout: "stdout.log"
      },
      ...(typeof input.model === "string" ? { model: input.model } : {}),
      projectRoot: input.projectRoot,
      provider: input.provider,
      resultMode: input.launch.resultMode,
      runId: input.runId,
      schemaVersion: 1,
      signal: null,
      startedAt: input.startedAt,
      status: "error"
   };
}

export function toRunResult(
   record: PersistedRunRecord,
   paths: RunPaths
): RunResult {
   if (!isTerminalStatus(record.status)) {
      throw new Error(`Run "${record.runId}" is not terminal.`);
   }

   return {
      agent: record.agent,
      agentPath: record.agentPath,
      agentScope: record.agentScope,
      artifacts: record.artifacts,
      ...(record.error ? { error: record.error } : {}),
      ...(typeof record.finalText === "string"
         ? { finalText: record.finalText }
         : {}),
      launchMode: record.launchMode,
      ...(record.next ? { next: record.next } : {}),
      ...(typeof record.outcome === "string"
         ? { outcome: record.outcome }
         : {}),
      projectRoot: record.projectRoot,
      provider: record.provider,
      resultMode: record.resultMode,
      rights: formatRunRights(record.provider),
      runId: record.runId,
      runFile: paths.runFile,
      status: record.status,
      ...(record.structuredResult !== undefined
         ? { structuredResult: record.structuredResult }
         : {}),
      ...(typeof record.summary === "string" ? { summary: record.summary } : {})
   };
}

export async function writeRunState(
   filePath: string,
   value: PersistedRunRecord
): Promise<void> {
   await writeFile(filePath, serializeRunRecord(value), "utf8");
}

export async function writeRunStateIfRunning(
   filePath: string,
   value: PersistedRunRecord
): Promise<boolean> {
   const existing = await readPersistedRunFile(filePath).catch((error) => {
      if (
         error instanceof UserError &&
         error.message === `Run file "${filePath}" was not found.`
      ) {
         return undefined;
      }

      throw error;
   });

   if (existing !== undefined && existing.status !== "running") {
      return false;
   }

   await writeRunState(filePath, value);
   return true;
}

export async function persistRunRecord(
   record: PersistedRunRecord,
   runFile: string
): Promise<void> {
   await writeRunState(runFile, record);
}

export async function readRunDetails(runId: string): Promise<RunInspection> {
   const paths = await findRunPaths(runId);
   const record = await readPersistedRunFile(paths.runFile);
   return enrichRunRecord(record, paths);
}

export async function listRunDetails(
   options?: RunListOptions
): Promise<RunInspection[]> {
   const { runsDir } = getProjectPaths();
   const dayDirectories = await listDirectories(runsDir);
   const runs: RunInspection[] = [];
   const targetCount = options?.limit;

   for (const dayDirectory of dayDirectories) {
      const dayDir = path.join(runsDir, dayDirectory);
      const runDirectories = await listDirectories(dayDir);

      for (const runDirectory of runDirectories) {
         const paths = buildRunPaths(path.join(dayDir, runDirectory));

         try {
            const record = await readPersistedRunFile(paths.runFile);
            runs.push(await enrichRunRecord(record, paths));
         } catch (error) {
            if (error instanceof UserError) {
               continue;
            }

            throw error;
         }
      }

      if (typeof targetCount === "number") {
         const filtered = applyRunListOptions(runs, options);
         if (filtered.length >= targetCount) {
            return filtered;
         }
      }
   }

   return applyRunListOptions(runs, options);
}

export async function readRunLog(
   runId: string,
   stream: "prompt" | "run" | "stderr" | "stdout"
): Promise<string> {
   const paths = await findRunPaths(runId);

   if (stream === "run") {
      return readFile(paths.runFile, "utf8");
   }

   if (stream === "prompt") {
      const record = await readPersistedRunFile(paths.runFile);
      return record.launch.renderedPrompt;
   }

   const filePath = stream === "stderr" ? paths.stderrLog : paths.stdoutLog;

   try {
      return await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         throw new UserError(`No ${stream} log exists for run "${runId}".`);
      }

      throw error;
   }
}
