import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { getProjectPaths } from "./paths.js";
import { formatRunRights } from "./provider-capabilities.js";
import { readMarkdownDocument, writeMarkdownDocument } from "./run-doc.js";
import type {
   LaunchMode,
   MarkdownDocument,
   MarkdownFrontmatter,
   MarkdownValue,
   PersistedRunRecord,
   ProviderId,
   PromptTransport,
   ResolvedSkill,
   ReasoningEffort,
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
   "agent",
   "agentPath",
   "agentScope",
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
   "provider",
   "reasoningEffort",
   "runId",
   "signal",
   "startedAt",
   "status",
   "usage"
]);

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
      runFile: path.join(runDir, "run.md"),
      runDir,
      stderrLog: path.join(runDir, "stderr.log"),
      stdoutLog: path.join(runDir, "stdout.log")
   };
}

function isProviderId(value: unknown): value is ProviderId {
   return value === "codex" || value === "gemini";
}

function isRunMode(value: unknown): value is RunMode {
   return value === "read-only" || value === "workspace-write";
}

function isLaunchMode(value: unknown): value is LaunchMode {
   return value === "foreground" || value === "detached";
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
   return value === "high" || value === "low" || value === "medium";
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

function getResolvedSkills(value: unknown): ResolvedSkill[] | undefined {
   if (!Array.isArray(value)) {
      return undefined;
   }

   const skills = value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
         return [];
      }

      const record = entry as Record<string, unknown>;
      const digest = record.digest;
      const name = record.name;
      const filePath = record.path;
      const scope = record.scope;

      if (
         typeof digest !== "string" ||
         typeof name !== "string" ||
         typeof filePath !== "string" ||
         (scope !== "project" && scope !== "user")
      ) {
         return [];
      }

      return [
         {
            digest,
            name,
            path: filePath,
            scope: scope as ResolvedSkill["scope"]
         }
      ];
   });

   return skills.length === value.length ? skills : undefined;
}

function getLaunchSnapshot(
   frontmatter: MarkdownFrontmatter
): RunLaunchSnapshot | undefined {
   const launch = getRecordValue(frontmatter, "launch");

   if (!launch) {
      return undefined;
   }

   const agentDigest = launch.agentDigest;
   const agentName = launch.agentName;
   const agentPath = launch.agentPath;
   const agentScope = launch.agentScope;
   const args = launch.args;
   const command = launch.command;
   const cwd = launch.cwd;
   const envKeys = launch.envKeys;
   const killGraceMs = launch.killGraceMs;
   const launchMode = launch.launchMode;
   const model = launch.model;
   const mode = launch.mode;
   const permissions = launch.permissions;
   const promptDigest = launch.promptDigest;
   const promptTransport = launch.promptTransport;
   const provider = launch.provider;
   const reasoningEffort = launch.reasoningEffort;
   const skills = getResolvedSkills(launch.skills) ?? [];
   const timeoutMs = launch.timeoutMs;

   if (
      typeof agentDigest !== "string" ||
      typeof agentName !== "string" ||
      typeof agentPath !== "string" ||
      (agentScope !== "project" && agentScope !== "user") ||
      !Array.isArray(args) ||
      args.some((value) => typeof value !== "string") ||
      typeof command !== "string" ||
      typeof cwd !== "string" ||
      !Array.isArray(envKeys) ||
      envKeys.some((value) => typeof value !== "string") ||
      typeof killGraceMs !== "number" ||
      !isLaunchMode(launchMode) ||
      !isRunMode(mode) ||
      !isRunMode(permissions) ||
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
      reasoningEffort !== undefined &&
      reasoningEffort !== null &&
      !isReasoningEffort(reasoningEffort)
   ) {
      return undefined;
   }

   return {
      agentDigest,
      agentName,
      agentPath,
      agentScope,
      args: args as string[],
      command,
      cwd,
      envKeys: envKeys as string[],
      killGraceMs,
      launchMode,
      ...(typeof model === "string" ? { model } : {}),
      mode,
      permissions,
      promptDigest,
      promptTransport,
      provider,
      ...(typeof reasoningEffort === "string" ? { reasoningEffort } : {}),
      skills,
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
      agent: value.agent,
      agentScope: value.agentScope,
      agentPath: value.agentPath,
      provider: value.provider,
      launchMode: value.launchMode,
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      mode: value.mode,
      cwd: value.cwd,
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
      ...(typeof value.reasoningEffort === "string"
         ? { reasoningEffort: value.reasoningEffort }
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
   const agent = getStringValue(frontmatter, "agent");
   const agentPath = getStringValue(frontmatter, "agentPath");
   const agentScope = getStringValue(frontmatter, "agentScope");
   const provider = frontmatter.provider;
   const launchMode = frontmatter.launchMode;
   const model = getStringValue(frontmatter, "model");
   const mode = frontmatter.mode;
   const cwd = getStringValue(frontmatter, "cwd");
   const launch = getLaunchSnapshot(frontmatter);
   const heartbeatAt = getStringValue(frontmatter, "heartbeatAt");
   const reasoningEffortValue = frontmatter.reasoningEffort;
   const reasoningEffort = isReasoningEffort(reasoningEffortValue)
      ? reasoningEffortValue
      : undefined;
   const startedAt = getStringValue(frontmatter, "startedAt");
   const status = frontmatter.status;

   if (
      typeof runId !== "string" ||
      typeof agent !== "string" ||
      (agentScope !== "project" && agentScope !== "user") ||
      typeof agentPath !== "string" ||
      !isProviderId(provider) ||
      !isLaunchMode(launchMode) ||
      !isRunMode(mode) ||
      typeof cwd !== "string" ||
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
         agent,
         agentPath,
         agentScope,
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
         provider,
         ...(typeof reasoningEffort === "string" ? { reasoningEffort } : {}),
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
      agent,
      agentPath,
      agentScope,
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
      provider,
      ...(typeof reasoningEffort === "string" ? { reasoningEffort } : {}),
      runId,
      signal,
      startedAt,
      status,
      ...(usage ? { usage } : {})
   };
}

export function createFailedRunRecord(input: {
   agent: string;
   agentPath: string;
   agentScope: "project" | "user";
   cwd: string;
   endedAt: string;
   errorMessage: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   model?: string;
   mode: RunMode;
   promptFile: string;
   provider: PersistedRunRecord["provider"];
   reasoningEffort?: ReasoningEffort;
   runDir: string;
   runId: string;
   startedAt: string;
   stderrLog?: string;
   stdoutLog?: string;
}): PersistedRunRecord {
   return {
      agent: input.agent,
      agentPath: input.agentPath,
      agentScope: input.agentScope,
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
         ...(typeof input.stderrLog === "string"
            ? { stderrLog: input.stderrLog }
            : {}),
         ...(typeof input.stdoutLog === "string"
            ? { stdoutLog: input.stdoutLog }
            : {})
      },
      provider: input.provider,
      ...(typeof input.reasoningEffort === "string"
         ? { reasoningEffort: input.reasoningEffort }
         : {}),
      runId: input.runId,
      signal: null,
      startedAt: input.startedAt,
      status: "error"
   };
}

export function toRunResult(record: PersistedRunRecord): RunResult {
   return {
      agent: record.agent,
      agentPath: record.agentPath,
      agentScope: record.agentScope,
      finalText: record.finalText,
      launchMode: record.launchMode,
      mode: record.mode,
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
}

export async function readRunDetails(runId: string): Promise<RunInspection> {
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
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

export async function listRunDetails(
   options?: RunListOptions
): Promise<RunInspection[]> {
   const projectPaths = getProjectPaths();

   let entries;
   try {
      entries = await readdir(projectPaths.runsDir, { withFileTypes: true });
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }

   const runs = await Promise.all(
      entries
         .filter((entry) => entry.isDirectory())
         .map(async (entry) => {
            try {
               return await readRunDetails(entry.name);
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
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
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
